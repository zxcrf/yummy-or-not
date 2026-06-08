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
import { withCors, corsPreflight } from '@/lib/cors';
import type { RegisterInput } from '@yon/shared';

export async function OPTIONS(req: NextRequest) {
  return corsPreflight(req.headers.get('origin'));
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get('origin');
  try {
    const { email: rawEmail, password, displayName } = (await req.json()) as RegisterInput;
    const email = normalizeEmail(rawEmail ?? '');

    if (!isValidEmail(email)) {
      return withCors(NextResponse.json({ error: 'invalid_email' }, { status: 400 }), origin);
    }
    if (!password || password.length < 6) {
      return withCors(NextResponse.json({ error: 'weak_password' }, { status: 400 }), origin);
    }
    if (await findUserByEmailWithHash(email)) {
      return withCors(NextResponse.json({ error: 'email_taken' }, { status: 409 }), origin);
    }

    const user = await createUser({
      email,
      passwordHash: hashPassword(password),
      displayName: displayName?.trim() || email.split('@')[0],
    });
    return establishSession(req, user);
  } catch (err) {
    console.error('POST /api/auth/register error:', err);
    return withCors(NextResponse.json({ error: 'Internal server error' }, { status: 500 }), origin);
  }
}
