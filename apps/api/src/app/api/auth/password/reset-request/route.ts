// POST /api/auth/password/reset-request — start a self-serve password reset.
// Generates a high-entropy token, stores only its hash, and "sends" it by email.
//
// Email delivery is pluggable: set EMAIL_WEBHOOK_URL to POST {email, token, link}
// to your mailer (an ops-side function that renders + sends the message). No SMTP
// or provider SDK lives here. Outside production the token is also returned as
// `devToken` and logged so the flow is testable with no mailer.
//
// Enumeration-safe: ALWAYS returns 200 regardless of whether the email exists.
// The token-creating work happens only when a user is actually found.
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { findUserByEmailWithHash, savePasswordResetToken } from '@/lib/db';
import {
  generateResetToken,
  hashCode,
  normalizeEmail,
  isValidEmail,
  PW_RESET_TTL_MS,
} from '@/lib/auth';
import { withCors, corsPreflight } from '@/lib/cors';
import { clientIp, enforceRateLimits, rateLimitedResponse } from '@/lib/rate-limit';
import type { PasswordResetRequestInput } from '@yon/shared';

async function deliver(email: string, token: string): Promise<void> {
  const link = `${process.env.APP_PUBLIC_URL ?? ''}/reset-password?token=${token}`;
  const url = process.env.EMAIL_WEBHOOK_URL;
  if (url) {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, token, link }),
    }).catch((e) => console.error('Email webhook failed:', e));
  }
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[pw-reset] token for ${email}: ${token}`);
  }
}

export async function OPTIONS(req: NextRequest) {
  return corsPreflight(req.headers.get('origin'));
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get('origin');
  try {
    const { email: rawEmail } = (await req.json()) as PasswordResetRequestInput;
    const email = normalizeEmail(rawEmail ?? '');
    if (!isValidEmail(email)) {
      return withCors(NextResponse.json({ error: 'invalid_email' }, { status: 400 }), origin);
    }
    const limited = await enforceRateLimits([
      { scope: 'auth:pw-reset-request:ip', identifier: clientIp(req), limit: 20, windowMs: 60 * 60 * 1000 },
      { scope: 'auth:pw-reset-request:email', identifier: email, limit: 3, windowMs: 10 * 60 * 1000 },
    ]);
    if (limited.limited) return rateLimitedResponse(origin, limited.retryAfterSeconds);

    // Only create + send a token when the account exists. Whether or not it does,
    // we return the SAME 200 body (sans devToken) so the caller can't enumerate.
    const found = await findUserByEmailWithHash(email);
    let token: string | null = null;
    if (found) {
      token = generateResetToken();
      await savePasswordResetToken(
        found.user.id,
        email,
        hashCode(token),
        new Date(Date.now() + PW_RESET_TTL_MS)
      );
      await deliver(email, token);
    }

    const body: { ok: true; devToken?: string } = { ok: true };
    if (process.env.NODE_ENV !== 'production' && token) body.devToken = token;
    return withCors(NextResponse.json(body), origin);
  } catch (err) {
    console.error('POST /api/auth/password/reset-request error:', err);
    return withCors(NextResponse.json({ error: 'Internal server error' }, { status: 500 }), origin);
  }
}
