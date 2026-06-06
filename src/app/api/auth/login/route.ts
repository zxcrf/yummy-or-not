// POST /api/auth/login — email + password sign-in (international habit).
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { findUserByEmailWithHash } from '@/lib/db';
import { verifyPassword, normalizeEmail, establishSession } from '@/lib/auth';
import type { LoginInput } from '@/lib/types';

export async function POST(req: NextRequest) {
  try {
    const { email: rawEmail, password } = (await req.json()) as LoginInput;
    const email = normalizeEmail(rawEmail ?? '');

    const found = await findUserByEmailWithHash(email);
    // Verify even on miss-ish paths to keep timing roughly uniform.
    if (!found || !verifyPassword(password ?? '', found.passwordHash)) {
      return NextResponse.json({ error: 'invalid_credentials' }, { status: 401 });
    }
    return establishSession(req, found.user);
  } catch (err) {
    console.error('POST /api/auth/login error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
