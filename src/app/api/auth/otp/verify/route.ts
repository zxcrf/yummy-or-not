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
import type { OtpVerifyInput } from '@/lib/types';

export async function POST(req: NextRequest) {
  try {
    const { phone: rawPhone, code } = (await req.json()) as OtpVerifyInput;
    const phone = normalizePhone(rawPhone ?? '');
    if (!isValidPhone(phone) || !/^[0-9]{6}$/.test(code ?? '')) {
      return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
    }

    const ok = await consumeOtp(phone, hashCode(code));
    if (!ok) {
      return NextResponse.json({ error: 'bad_code' }, { status: 401 });
    }

    const user = await findOrCreateUserByPhone(phone);
    return establishSession(req, user);
  } catch (err) {
    console.error('POST /api/auth/otp/verify error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
