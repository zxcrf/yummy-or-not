// PATCH /api/user — update the signed-in user's settings (warningsEnabled).
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { updateUserWarnings } from '@/lib/db';
import { withCors, corsPreflight } from '@/lib/cors';
import { getUserFromRequest } from '@/lib/auth';

export async function OPTIONS(req: NextRequest) {
  return corsPreflight(req.headers.get('origin'));
}

export async function PATCH(req: NextRequest) {
  const origin = req.headers.get('origin');
  const user = await getUserFromRequest(req);
  if (!user) return withCors(NextResponse.json({ error: 'unauthorized' }, { status: 401 }), origin);

  try {
    const body = await req.json().catch(() => ({}));

    if (typeof body?.warningsEnabled !== 'boolean') {
      return withCors(
        NextResponse.json({ error: 'warningsEnabled must be a boolean' }, { status: 400 }),
        origin
      );
    }

    const updated = await updateUserWarnings(user.id, body.warningsEnabled);
    if (!updated) {
      return withCors(NextResponse.json({ error: 'not_found' }, { status: 404 }), origin);
    }
    return withCors(NextResponse.json({ user: updated }), origin);
  } catch (err) {
    console.error('PATCH /api/user error:', err);
    return withCors(NextResponse.json({ error: 'Internal server error' }, { status: 500 }), origin);
  }
}
