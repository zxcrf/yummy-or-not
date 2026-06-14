// POST /api/auth/password/reset-verify — finish a password reset.
// Consumes the emailed token (single-use), sets the new password, and revokes
// every existing session for the user so a stolen old session can't survive the
// reset. Failures return a generic 401 `bad_token` (no detail about which check
// failed) to keep the endpoint enumeration- and probe-resistant.
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { applyPasswordReset } from '@/lib/db';
import {
  hashCode,
  hashPassword,
  normalizeEmail,
  isValidEmail,
} from '@/lib/auth';
import { withCors, corsPreflight } from '@/lib/cors';
import { clientIp, enforceRateLimits, rateLimitedResponse } from '@/lib/rate-limit';
import type { PasswordResetVerifyInput } from '@yon/shared';

export async function OPTIONS(req: NextRequest) {
  return corsPreflight(req.headers.get('origin'));
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get('origin');
  try {
    const { email: rawEmail, token, newPassword } = (await req.json()) as PasswordResetVerifyInput;
    const email = normalizeEmail(rawEmail ?? '');
    if (!isValidEmail(email) || !token) {
      return withCors(NextResponse.json({ error: 'invalid_input' }, { status: 400 }), origin);
    }
    if (!newPassword || newPassword.length < 8) {
      return withCors(NextResponse.json({ error: 'weak_password' }, { status: 400 }), origin);
    }
    const limited = await enforceRateLimits([
      { scope: 'auth:pw-reset-verify:ip', identifier: clientIp(req), limit: 30, windowMs: 10 * 60 * 1000 },
      { scope: 'auth:pw-reset-verify:email', identifier: email, limit: 5, windowMs: 10 * 60 * 1000 },
    ]);
    if (limited.limited) return rateLimitedResponse(origin, limited.retryAfterSeconds);

    // All four steps (consume token, burn other outstanding tokens, set new
    // password, revoke sessions) run in one DB transaction — all commit or all
    // roll back. Token is bound to the supplied email to close the rate-limit
    // bypass described in the security review.
    const applied = await applyPasswordReset(hashCode(token), email, hashPassword(newPassword));
    if (!applied) {
      return withCors(NextResponse.json({ error: 'bad_token' }, { status: 401 }), origin);
    }

    return withCors(NextResponse.json({ ok: true }), origin);
  } catch (err) {
    console.error('POST /api/auth/password/reset-verify error:', err);
    return withCors(NextResponse.json({ error: 'Internal server error' }, { status: 500 }), origin);
  }
}
