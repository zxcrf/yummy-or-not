// GET /api/feed/geo?cell=<geohash> — S3c cross-user cell card stream.
//
// Returns the COARSENED, anonymous cards published to geo within one grid cell.
// The db helper only ever returns 'shared' geo rows with the safe shape
// (grid_cell + display fields, NEVER precise coords / owner identity) — the route
// passes them through unchanged. A missing `cell` → 400 (no unbounded scan).
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { listGeoFeedByCell } from '@/lib/db';
import { withCors, corsPreflight } from '@/lib/cors';

export async function OPTIONS(req: NextRequest) {
  return corsPreflight(req.headers.get('origin'));
}

export async function GET(req: NextRequest) {
  const origin = req.headers.get('origin');
  const cell = req.nextUrl.searchParams.get('cell');
  if (!cell) {
    return withCors(NextResponse.json({ error: 'cell_required' }, { status: 400 }), origin);
  }
  try {
    const cards = await listGeoFeedByCell(cell);
    return withCors(NextResponse.json(cards), origin);
  } catch (err) {
    console.error('GET /api/feed/geo error:', err);
    return withCors(NextResponse.json({ error: 'Internal server error' }, { status: 500 }), origin);
  }
}
