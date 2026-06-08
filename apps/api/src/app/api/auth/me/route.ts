// GET /api/auth/me — the current user, plus which social logins are available.
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { listProviderStatus } from '@/lib/oauth';
import { withCors, corsPreflight } from '@/lib/cors';

export async function OPTIONS(req: NextRequest) {
  return corsPreflight(req.headers.get('origin'));
}

export async function GET(req: NextRequest) {
  const origin = req.headers.get('origin');
  const user = await getUserFromRequest(req);
  // `providers` is secret-free, so it's safe to return even when signed out —
  // the login screen uses it to decide which social buttons to show.
  return withCors(NextResponse.json({ user, providers: listProviderStatus() }), origin);
}
