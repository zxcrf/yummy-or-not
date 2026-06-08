// GET /api/health — liveness probe; also keeps `next build` happy with no pages.
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { withCors, corsPreflight } from '@/lib/cors';

export async function GET(req: NextRequest) {
  return withCors(NextResponse.json({ ok: true }), req.headers.get('origin'));
}

export async function OPTIONS(req: NextRequest) {
  return corsPreflight(req.headers.get('origin'));
}
