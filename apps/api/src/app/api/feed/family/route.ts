// GET /api/feed/family?member=<id> — S3c family / member feed.
//
// Requires auth (anonymous → 401, never queries). Visibility scoping is enforced
// server-side: the helper only ever returns 'shared' rows targeted to a family /
// member, and the route hands it the viewer id + optional member filter.
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { listFamilyFeed } from '@/lib/db';
import { withCors, corsPreflight } from '@/lib/cors';
import { getUserFromRequest } from '@/lib/auth';

export async function OPTIONS(req: NextRequest) {
  return corsPreflight(req.headers.get('origin'));
}

export async function GET(req: NextRequest) {
  const origin = req.headers.get('origin');
  const user = await getUserFromRequest(req);
  if (!user) return withCors(NextResponse.json({ error: 'unauthorized' }, { status: 401 }), origin);

  const member = req.nextUrl.searchParams.get('member') ?? undefined;
  try {
    const cards = await listFamilyFeed({ viewerId: user.id, member });
    return withCors(NextResponse.json(cards), origin);
  } catch (err) {
    console.error('GET /api/feed/family error:', err);
    return withCors(NextResponse.json({ error: 'Internal server error' }, { status: 500 }), origin);
  }
}
