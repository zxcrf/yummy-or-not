// POST /api/auth/otp/verify — finish a phone login with the texted code.
// On success the phone's account is created on first use, then signed in.
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { consumeOtp, findOrCreateUserByPhone } from '@/lib/db';
import {
  hashCode,
  normalizePhone,
  isValidPhone,
  establishSession,
} from '@/lib/auth';
import { withCors, corsPreflight } from '@/lib/cors';
import { clientIp, enforceRateLimits, rateLimitedResponse } from '@/lib/rate-limit';
import type { OtpVerifyInput } from '@yon/shared';

export async function OPTIONS(req: NextRequest) {
  return corsPreflight(req.headers.get('origin'));
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get('origin');
  try {
    const { phone: rawPhone, code } = (await req.json()) as OtpVerifyInput;
    const phone = normalizePhone(rawPhone ?? '');
    if (!isValidPhone(phone) || !/^[0-9]{6}$/.test(code ?? '')) {
      return withCors(NextResponse.json({ error: 'invalid_input' }, { status: 400 }), origin);
    }
    const limited = await enforceRateLimits([
      { scope: 'auth:otp-verify:ip', identifier: clientIp(req), limit: 30, windowMs: 10 * 60 * 1000 },
      { scope: 'auth:otp-verify:phone', identifier: phone, limit: 5, windowMs: 10 * 60 * 1000 },
    ]);
    if (limited.limited) return rateLimitedResponse(origin, limited.retryAfterSeconds);

    const ok = await consumeOtp(phone, hashCode(code));
    if (!ok) {
      return withCors(NextResponse.json({ error: 'bad_code' }, { status: 401 }), origin);
    }

    const user = await findOrCreateUserByPhone(phone);
    return establishSession(req, user);
  } catch (err) {
    console.error('POST /api/auth/otp/verify error:', err);
    return withCors(NextResponse.json({ error: 'Internal server error' }, { status: 500 }), origin);
  }
}
