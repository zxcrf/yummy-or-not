// GET /api/tastes/[id]/original — return a short-lived presigned URL to the
// full-resolution original upload. Pro plan only.
//
// 200 { url: string; expiresIn: number }
// 403 { error: 'pro_required' }   — caller is on the free plan
// 404                              — taste not found / not owned by user
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { getRawImage } from '@/lib/db';
import { withCors, corsPreflight } from '@/lib/cors';
import { getUserFromRequest } from '@/lib/auth';
import { getSignedPhotoUrl, PRESIGN_TTL_SECONDS } from '@/lib/storage';
import { isVariantKey } from '@/lib/image-variants';

type RouteContext = { params: Promise<{ id: string }> };

export async function OPTIONS(req: NextRequest) {
  return corsPreflight(req.headers.get('origin'));
}

export async function GET(req: NextRequest, { params }: RouteContext) {
  const origin = req.headers.get('origin');
  const user = await getUserFromRequest(req);
  if (!user) return withCors(NextResponse.json({ error: 'unauthorized' }, { status: 401 }), origin);

  const { id } = await params;

  const rawImage = await getRawImage(user.id, id);
  if (!rawImage) {
    return withCors(NextResponse.json({ error: 'Not found' }, { status: 404 }), origin);
  }

  if (user.plan !== 'pro') {
    return withCors(NextResponse.json({ error: 'pro_required' }, { status: 403 }), origin);
  }

  try {
    // Legacy absolute values (seed rows, blob full URLs, /uploads paths) are
    // already URLs — return as-is; they cannot (and need not) be presigned.
    if (
      rawImage.startsWith('http://') ||
      rawImage.startsWith('https://') ||
      rawImage.startsWith('/uploads/')
    ) {
      return withCors(NextResponse.json({ url: rawImage, expiresIn: PRESIGN_TTL_SECONDS }), origin);
    }
    // Bare keys are only ever assigned server-side (variant orig keys or
    // pre-variant flat keys); client-supplied bare keys are rejected at create
    // time, so presigning an owned bare key cannot leak another user's object.
    const key = isVariantKey(rawImage) ? rawImage : rawImage.replace(/^\//, '');
    const url = await getSignedPhotoUrl(key, PRESIGN_TTL_SECONDS);
    return withCors(NextResponse.json({ url, expiresIn: PRESIGN_TTL_SECONDS }), origin);
  } catch (err) {
    console.error(`GET /api/tastes/${id}/original error:`, err);
    return withCors(NextResponse.json({ error: 'Internal server error' }, { status: 500 }), origin);
  }
}
