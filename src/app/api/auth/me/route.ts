// GET /api/auth/me — the current user, plus which social logins are available.
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { listProviderStatus } from '@/lib/oauth';

export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req);
  // `providers` is secret-free, so it's safe to return even when signed out —
  // the login screen uses it to decide which social buttons to show.
  return NextResponse.json({ user, providers: listProviderStatus() });
}
