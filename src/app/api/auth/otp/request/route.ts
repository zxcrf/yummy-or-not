// POST /api/auth/otp/request — start a phone login (domestic habit).
// Generates a 6-digit code, stores only its hash, and "sends" it.
//
// SMS delivery is pluggable: set SMS_WEBHOOK_URL to POST {phone, code} to your
// gateway (Aliyun/Tencent Cloud SMS, Twilio, …). Outside production the code is
// also returned as `devCode` and logged, so the flow is testable with no gateway.
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { saveOtp } from '@/lib/db';
import {
  generateOtp,
  hashCode,
  normalizePhone,
  isValidPhone,
  OTP_TTL_MS,
} from '@/lib/auth';
import type { OtpRequestInput } from '@/lib/types';

async function deliver(phone: string, code: string): Promise<void> {
  const url = process.env.SMS_WEBHOOK_URL;
  if (url) {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, code }),
    }).catch((e) => console.error('SMS webhook failed:', e));
  }
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[otp] code for ${phone}: ${code}`);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { phone: rawPhone } = (await req.json()) as OtpRequestInput;
    const phone = normalizePhone(rawPhone ?? '');
    if (!isValidPhone(phone)) {
      return NextResponse.json({ error: 'invalid_phone' }, { status: 400 });
    }

    const code = generateOtp();
    await saveOtp(phone, hashCode(code), new Date(Date.now() + OTP_TTL_MS));
    await deliver(phone, code);

    const body: { ok: true; devCode?: string } = { ok: true };
    if (process.env.NODE_ENV !== 'production') body.devCode = code;
    return NextResponse.json(body);
  } catch (err) {
    console.error('POST /api/auth/otp/request error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
