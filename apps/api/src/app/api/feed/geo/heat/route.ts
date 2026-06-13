// GET /api/feed/geo/heat?bbox=minLng,minLat,maxLng,maxLat — S3c grid heat.
//
// Returns ONLY [{ cell, count }] grid aggregation for published geo shares in the
// bbox — no per-record rows, no coords, no identity. A missing/malformed bbox →
// 400.
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { geoHeat } from '@/lib/db';
import { withCors, corsPreflight } from '@/lib/cors';

export async function OPTIONS(req: NextRequest) {
  return corsPreflight(req.headers.get('origin'));
}

export async function GET(req: NextRequest) {
  const origin = req.headers.get('origin');
  const bboxRaw = req.nextUrl.searchParams.get('bbox');
  const parts = (bboxRaw ?? '').split(',').map((s) => Number(s.trim()));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    return withCors(NextResponse.json({ error: 'bbox_required' }, { status: 400 }), origin);
  }
  const [minLng, minLat, maxLng, maxLat] = parts;
  try {
    const heat = await geoHeat({ minLng, minLat, maxLng, maxLat });
    return withCors(NextResponse.json(heat), origin);
  } catch (err) {
    console.error('GET /api/feed/geo/heat error:', err);
    return withCors(NextResponse.json({ error: 'Internal server error' }, { status: 500 }), origin);
  }
}
