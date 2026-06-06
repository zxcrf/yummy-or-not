// POST /api/auth/logout — revoke the current session and clear the cookie.
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { deleteSession } from '@/lib/db';
import { SESSION_COOKIE, clearSessionCookie } from '@/lib/auth';

export async function POST(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (token) {
    await deleteSession(token).catch((e) => console.error('logout error:', e));
  }
  const res = NextResponse.json({ ok: true });
  clearSessionCookie(res);
  return res;
}
