// POST /api/auth/password/reset-request — start a self-serve password reset.
// Generates a high-entropy token, stores only its hash, and emails it.
//
// Email transport is selected by env, in priority order:
//   1. RESEND_API_KEY set → send via Resend's REST API (POST api.resend.com,
//      plain fetch — no SDK dep; matches auth.ts's "Node built-ins only" ethos
//      and reuses the existing global.fetch test seam). Mobile-only product, so
//      the link is the `yummyornot://reset-password?token=…` deep link.
//   2. else EMAIL_WEBHOOK_URL set → POST {email, token, link} to an ops mailer.
//   3. else prod → console.error (delivery impossible); dev → console.log token.
// Absence of any provider never crashes — it falls through to the warning.
//
// Enumeration-safe: ALWAYS returns 200 regardless of whether the email exists.
//
// Timing-safe (MED-A): both branches pay the same minimum wall-clock cost:
//   • token generation + hashCode run UNCONDITIONALLY before the lookup;
//   • the response is held behind a fixed deadline (MIN_RESPONSE_MS) so
//     found vs. not-found are indistinguishable by latency.
//   • deliver() is fire-and-forget (not awaited) so provider RTT is never
//     on the hot path — a slow/failing Resend or webhook cannot leak timing
//     and cannot change the response or status.
//
// Delivery observability (MED-B): non-2xx provider responses are console.error'd
// so they surface in logs/alerting. An unconfigured provider in production is
// also warned so it isn't silently swallowed.
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
import { resetEmail } from '@/lib/email-templates';
import { withCors, corsPreflight } from '@/lib/cors';
import { clientIp, enforceRateLimits, rateLimitedResponse } from '@/lib/rate-limit';
import type { PasswordResetRequestInput } from '@yon/shared';

/** Minimum wall-clock time (ms) before the handler responds. Applied to BOTH
 *  the found and not-found paths so latency cannot distinguish them (MED-A). */
const MIN_RESPONSE_MS = 150;

/** Send the reset email via Resend's REST API. Logs on non-2xx (MED-B).
 *  Plain fetch, no SDK. Called only from the fire-and-forget deliver(). */
async function sendViaResend(email: string, token: string, link: string): Promise<void> {
  // Surface the common misconfig (key set, from-address not) in ops logs:
  // the resend.dev fallback only works on a fresh sandbox and is rejected once
  // a verified domain is required, which would otherwise be a silent non-send.
  if (!process.env.EMAIL_FROM) {
    console.error('[pw-reset] RESEND_API_KEY is set but EMAIL_FROM is not — falling back to resend.dev sender, which will be rejected for a verified domain');
  }
  const { subject, text, html } = resetEmail({ token, link });
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM ?? 'Yummy or Not <onboarding@resend.dev>',
      to: email,
      subject,
      text,
      html,
    }),
  });
  if (!res.ok) {
    console.error(`[pw-reset] Resend returned ${res.status} for ${email}`);
  }
}

/** Fire-and-forget background delivery task (MED-B).
 *  Selects a transport by env (Resend → webhook → log). Awaits the provider
 *  response only to log non-2xx — never re-thrown onto the response hot path. */
async function deliver(email: string, token: string): Promise<void> {
  // Mobile-only: deep link opens the app straight to the new-password step.
  // Kept inline (not imported from @yon/shared) so the API stays free of a
  // runtime cross-package import — the URL shape is the contract, parsed back
  // by shared's extractResetToken / RESET_PATH on the mobile side.
  const link = `yummyornot://reset-password?token=${token}`;
  try {
    if (process.env.RESEND_API_KEY) {
      await sendViaResend(email, token, link);
    } else if (process.env.EMAIL_WEBHOOK_URL) {
      const res = await fetch(process.env.EMAIL_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, token, link }),
      });
      if (!res.ok) {
        console.error(`[pw-reset] email webhook returned ${res.status} for ${email}`);
      }
    } else if (process.env.NODE_ENV === 'production') {
      console.error('[pw-reset] no email provider configured (RESEND_API_KEY / EMAIL_WEBHOOK_URL) — reset email cannot be delivered');
    }
  } catch (e) {
    console.error('[pw-reset] email delivery network error:', e);
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
    }

    // Hold the response until the deadline has elapsed. Both branches wait
    // the same floor so latency cannot reveal whether the email was found.
    await deadline;

    // Defer delivery to AFTER the deadline via setImmediate so that even the
    // synchronous part of deliver() (email-template build, JSON.stringify) runs
    // off the response hot path — only the found branch does any send work, and
    // none of it precedes the response (timing-safety, MED-A).
    if (savedToken) {
      const token = savedToken;
      setImmediate(() => { void deliver(email, token); });
    }

    const body: { ok: true; devToken?: string } = { ok: true };
    if (process.env.NODE_ENV !== 'production' && savedToken) body.devToken = savedToken;
    return withCors(NextResponse.json(body), origin);
  } catch (err) {
    console.error('POST /api/auth/password/reset-request error:', err);
    return withCors(NextResponse.json({ error: 'Internal server error' }, { status: 500 }), origin);
  }
}
