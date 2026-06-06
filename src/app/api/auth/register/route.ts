// POST /api/auth/register — email + password sign-up (international habit).
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { findUserByEmailWithHash, createUser } from '@/lib/db';
import {
  hashPassword,
  normalizeEmail,
  isValidEmail,
  establishSession,
} from '@/lib/auth';
import type { RegisterInput } from '@/lib/types';

export async function POST(req: NextRequest) {
  try {
    const { email: rawEmail, password, displayName } = (await req.json()) as RegisterInput;
    const email = normalizeEmail(rawEmail ?? '');

    if (!isValidEmail(email)) {
      return NextResponse.json({ error: 'invalid_email' }, { status: 400 });
    }
    if (!password || password.length < 6) {
      return NextResponse.json({ error: 'weak_password' }, { status: 400 });
    }
    if (await findUserByEmailWithHash(email)) {
      return NextResponse.json({ error: 'email_taken' }, { status: 409 });
    }

    const user = await createUser({
      email,
      passwordHash: hashPassword(password),
      displayName: displayName?.trim() || email.split('@')[0],
    });
    return establishSession(req, user);
  } catch (err) {
    console.error('POST /api/auth/register error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
