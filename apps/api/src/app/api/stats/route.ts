// GET /api/stats — aggregate taste counts + saved amount
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { getStats } from '@/lib/db';
import { withCors, corsPreflight } from '@/lib/cors';
import { getUserFromRequest } from '@/lib/auth';

export async function OPTIONS(req: NextRequest) {
  return corsPreflight(req.headers.get('origin'));
}

export async function GET(req: NextRequest) {
  const origin = req.headers.get('origin');
  const user = await getUserFromRequest(req);
  if (!user) return withCors(NextResponse.json({ error: 'unauthorized' }, { status: 401 }), origin);
  try {
    const stats = await getStats(user.id);
    return withCors(NextResponse.json(stats), origin);
  } catch (err) {
    console.error('GET /api/stats error:', err);
    return withCors(NextResponse.json({ error: 'Internal server error' }, { status: 500 }), origin);
  }
}
