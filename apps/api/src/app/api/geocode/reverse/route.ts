// GET /api/geocode/reverse?lat=<wgs84>&lng=<wgs84>
// Auth-required. Routes to AMap (China) or Nominatim (overseas).
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { withCors, corsPreflight } from '@/lib/cors';
import { getUserFromRequest } from '@/lib/auth';
import { wgs84ToGcj02, isInsideChina } from '@yon/shared';

const UPSTREAM_TIMEOUT_MS = 5000;

function abortAfter(ms: number): { ctrl: AbortController; clear: () => void } {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  return { ctrl, clear: () => clearTimeout(id) };
}

async function fetchAmap(
  wgsLat: number,
  wgsLng: number,
  key: string,
): Promise<string | null> {
  const { lat: gcjLat, lng: gcjLng } = wgs84ToGcj02(wgsLat, wgsLng);
  const url =
    `https://restapi.amap.com/v3/geocode/regeo` +
    `?key=${key}&location=${gcjLng},${gcjLat}&extensions=base&radius=200`;
  const { ctrl, clear } = abortAfter(UPSTREAM_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      regeocode?: { formatted_address?: string };
    };
    return data.regeocode?.formatted_address || null;
  } finally {
    clear();
  }
}

async function fetchNominatim(
  lat: number,
  lng: number,
  locale: string,
): Promise<string | null> {
  const url =
    `https://nominatim.openstreetmap.org/reverse` +
    `?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18&accept-language=${locale}`;
  const { ctrl, clear } = abortAfter(UPSTREAM_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        'User-Agent': 'yummy-or-not/1.0 (+https://yon.baobao.click)',
      },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { display_name?: string };
    return data.display_name || null;
  } finally {
    clear();
  }
}

export async function OPTIONS(req: NextRequest) {
  return corsPreflight(req.headers.get('origin'));
}

export async function GET(req: NextRequest) {
  const origin = req.headers.get('origin');
  const user = await getUserFromRequest(req);
  if (!user)
    return withCors(NextResponse.json({ error: 'unauthorized' }, { status: 401 }), origin);

  const { searchParams } = req.nextUrl;
  const latRaw = searchParams.get('lat');
  const lngRaw = searchParams.get('lng');
  const lat = latRaw != null ? parseFloat(latRaw) : NaN;
  const lng = lngRaw != null ? parseFloat(lngRaw) : NaN;

  if (!Number.isFinite(lat) || lat < -90 || lat > 90 ||
      !Number.isFinite(lng) || lng < -180 || lng > 180) {
    return withCors(NextResponse.json({ error: 'invalid_coords' }, { status: 400 }), origin);
  }

  const locale =
    (req.headers.get('accept-language') ?? '').split(',')[0]?.split(';')[0]?.trim() || 'en';

  try {
    if (isInsideChina(lat, lng)) {
      const amapKey = process.env.AMAP_KEY;
      if (amapKey) {
        try {
          const place = await fetchAmap(lat, lng, amapKey);
          return withCors(NextResponse.json({ place, source: 'amap' }), origin);
        } catch {
          // AMap failed — fall through to Nominatim
        }
      }
    }

    // Overseas or AMap unavailable
    try {
      const place = await fetchNominatim(lat, lng, locale);
      return withCors(NextResponse.json({ place, source: 'nominatim' }), origin);
    } catch {
      return withCors(NextResponse.json({ place: null }), origin);
    }
  } catch {
    return withCors(NextResponse.json({ place: null }), origin);
  }
}
