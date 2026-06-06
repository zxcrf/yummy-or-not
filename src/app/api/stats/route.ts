// GET /api/stats — aggregate taste counts + saved amount (for the signed-in user)
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { getStats } from '@/lib/db';
import { getUserFromRequest } from '@/lib/auth';

export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const stats = await getStats(user.id);
    return NextResponse.json(stats);
  } catch (err) {
    console.error('GET /api/stats error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
