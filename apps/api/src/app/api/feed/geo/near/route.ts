// GET /api/feed/geo/near?lat=&lng=&radius= — S3c PostGIS radius feed.
//
// The SERVER runs a precise ST_DWithin radius query, but the RESPONSE is the
// COARSENED card shape (grid_cell + display fields, never precise coords / owner
// identity) — the db helper enforces this and the route never widens it. Missing
// or non-numeric params → 400. The radius is CLAMPED so the "nearby" feed can't
// be turned into a whole-region scrape.
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { listGeoFeedNear } from '@/lib/db';
import { withCors, corsPreflight } from '@/lib/cors';

// Keep this a *nearby* feed, not a global dump (§S3c privacy boundary).
const MAX_RADIUS_M = 50_000;

export async function OPTIONS(req: NextRequest) {
  return corsPreflight(req.headers.get('origin'));
}

function num(v: string | null): number | null {
  if (v == null || v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function GET(req: NextRequest) {
  const origin = req.headers.get('origin');
  const params = req.nextUrl.searchParams;
  const lat = num(params.get('lat'));
  const lng = num(params.get('lng'));
  const radius = num(params.get('radius'));

  if (lat == null || lng == null || radius == null || radius <= 0) {
    return withCors(NextResponse.json({ error: 'lat_lng_radius_required' }, { status: 400 }), origin);
  }

  const radiusM = Math.min(radius, MAX_RADIUS_M);
  try {
    const cards = await listGeoFeedNear({ lat, lng, radiusM });
    return withCors(NextResponse.json(cards), origin);
  } catch (err) {
    console.error('GET /api/feed/geo/near error:', err);
    return withCors(NextResponse.json({ error: 'Internal server error' }, { status: 500 }), origin);
  }
}
