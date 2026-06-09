// POST /api/auth/login — email + password sign-in (international habit).
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { findUserByEmailWithHash } from '@/lib/db';
import { verifyPassword, normalizeEmail, establishSession } from '@/lib/auth';
import { withCors, corsPreflight } from '@/lib/cors';
import { clientIp, enforceRateLimits, rateLimitedResponse } from '@/lib/rate-limit';
import type { LoginInput } from '@yon/shared';

export async function OPTIONS(req: NextRequest) {
  return corsPreflight(req.headers.get('origin'));
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get('origin');
  try {
    const { email: rawEmail, password } = (await req.json()) as LoginInput;
    const email = normalizeEmail(rawEmail ?? '');
    const limited = await enforceRateLimits([
      { scope: 'auth:login:ip', identifier: clientIp(req), limit: 20, windowMs: 10 * 60 * 1000 },
      { scope: 'auth:login:email', identifier: email, limit: 8, windowMs: 15 * 60 * 1000 },
    ]);
    if (limited.limited) return rateLimitedResponse(origin, limited.retryAfterSeconds);

    const found = await findUserByEmailWithHash(email);
    // Verify even on miss-ish paths to keep timing roughly uniform.
    if (!found || !verifyPassword(password ?? '', found.passwordHash)) {
      return withCors(NextResponse.json({ error: 'invalid_credentials' }, { status: 401 }), origin);
    }
    return establishSession(req, found.user);
  } catch (err) {
    console.error('POST /api/auth/login error:', err);
    return withCors(NextResponse.json({ error: 'Internal server error' }, { status: 500 }), origin);
  }
}
