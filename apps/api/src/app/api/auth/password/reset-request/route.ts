// POST /api/auth/password/reset-request — start a self-serve password reset.
// Generates a high-entropy token, stores only its hash, and "sends" it by email.
//
// Email delivery is pluggable: set EMAIL_WEBHOOK_URL to POST {email, token, link}
// to your mailer (an ops-side function that renders + sends the message). No SMTP
// or provider SDK lives here. Outside production the token is also returned as
// `devToken` and logged so the flow is testable with no mailer.
//
// Enumeration-safe: ALWAYS returns 200 regardless of whether the email exists.
//
// Timing-safe (MED-A): both branches pay the same minimum wall-clock cost:
//   • token generation + hashCode run UNCONDITIONALLY before the lookup;
//   • the response is held behind a fixed deadline (MIN_RESPONSE_MS) so
//     found vs. not-found are indistinguishable by latency.
//   • deliver() is fire-and-forget (not awaited) so webhook RTT is never
//     on the hot path.
//
// Delivery observability (MED-B): non-2xx webhook responses are console.error'd
// so they surface in logs/alerting. An unset EMAIL_WEBHOOK_URL in production
// is also warned so it isn't silently swallowed.
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

/** Minimum wall-clock time (ms) before the handler responds. Applied to BOTH
 *  the found and not-found paths so latency cannot distinguish them (MED-A). */
const MIN_RESPONSE_MS = 150;

/** Fire-and-forget background delivery task (MED-B).
 *  Awaits the webhook response and logs on non-2xx so failures surface in
 *  ops logs. Warns when EMAIL_WEBHOOK_URL is unset in production. */
async function deliver(email: string, token: string): Promise<void> {
  const link = `${process.env.APP_PUBLIC_URL ?? ''}/reset-password?token=${token}`;
  const url = process.env.EMAIL_WEBHOOK_URL;
  if (url) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, token, link }),
      });
      if (!res.ok) {
        console.error(`[pw-reset] email webhook returned ${res.status} for ${email}`);
      }
    } catch (e) {
      console.error('[pw-reset] email webhook network error:', e);
    }
  } else if (process.env.NODE_ENV === 'production') {
    console.error('[pw-reset] EMAIL_WEBHOOK_URL is not set — reset email cannot be delivered');
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

    // Generate token + hash UNCONDITIONALLY so both branches pay the same
    // CPU cost regardless of whether the email is registered (MED-A).
    const rawToken = generateResetToken();
    const tokenHash = hashCode(rawToken);

    // Start the minimum-latency clock before the DB lookup (MED-A).
    const deadline = new Promise<void>((resolve) => setTimeout(resolve, MIN_RESPONSE_MS));

    const found = await findUserByEmailWithHash(email);
    let savedToken: string | null = null;
    if (found) {
      await savePasswordResetToken(
        found.user.id,
        email,
        tokenHash,
        new Date(Date.now() + PW_RESET_TTL_MS)
      );
      savedToken = rawToken;
      void deliver(email, rawToken); // fire-and-forget: webhook RTT must not be observable
    }

    // Hold the response until the deadline has elapsed. Both branches wait
    // the same floor so latency cannot reveal whether the email was found.
    await deadline;

    const body: { ok: true; devToken?: string } = { ok: true };
    if (process.env.NODE_ENV !== 'production' && savedToken) body.devToken = savedToken;
    return withCors(NextResponse.json(body), origin);
  } catch (err) {
    console.error('POST /api/auth/password/reset-request error:', err);
    return withCors(NextResponse.json({ error: 'Internal server error' }, { status: 500 }), origin);
  }
}
