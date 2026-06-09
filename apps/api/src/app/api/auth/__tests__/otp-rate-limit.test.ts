import { NextRequest } from 'next/server';

jest.mock('@/lib/db', () => ({
  saveOtp: jest.fn(),
  consumeOtp: jest.fn(),
  findOrCreateUserByPhone: jest.fn(),
}));

jest.mock('@/lib/auth', () => ({
  generateOtp: jest.fn(() => '123456'),
  hashCode: jest.fn((code: string) => `hash:${code}`),
  normalizePhone: jest.fn((phone: string) => phone),
  isValidPhone: jest.fn(() => true),
  establishSession: jest.fn(),
  OTP_TTL_MS: 300_000,
}));

jest.mock('@/lib/cors', () => ({
  withCors: (res: unknown) => res,
  corsPreflight: () => {
    const { NextResponse } = require('next/server');
    return new NextResponse(null, { status: 204 });
  },
}));

jest.mock('@/lib/rate-limit', () => ({
  clientIp: jest.fn(() => '203.0.113.1'),
  enforceRateLimits: jest.fn(),
  rateLimitedResponse: jest.fn((_origin: string | null, retryAfterSeconds: number) => {
    const { NextResponse } = require('next/server');
    const res = NextResponse.json({ error: 'rate_limited' }, { status: 429 });
    res.headers.set('Retry-After', String(retryAfterSeconds));
    return res;
  }),
}));

import { POST as requestOtp } from '@/app/api/auth/otp/request/route';
import { POST as verifyOtp } from '@/app/api/auth/otp/verify/route';
import { consumeOtp, saveOtp } from '@/lib/db';
import { enforceRateLimits } from '@/lib/rate-limit';

function reqOf(path: string, body: object) {
  return new NextRequest(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  (enforceRateLimits as jest.Mock).mockResolvedValue({
    limited: true,
    retryAfterSeconds: 90,
  });
});

describe('OTP auth rate limiting', () => {
  it('returns 429 before creating an OTP code when request is limited', async () => {
    const res = await requestOtp(reqOf('/api/auth/otp/request', { phone: '+15550100' }));
    const body = await res.json();

    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('90');
    expect(body).toEqual({ error: 'rate_limited' });
    expect(saveOtp).not.toHaveBeenCalled();
  });

  it('returns 429 before consuming an OTP code when verify is limited', async () => {
    const res = await verifyOtp(reqOf('/api/auth/otp/verify', {
      phone: '+15550100',
      code: '123456',
    }));
    const body = await res.json();

    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('90');
    expect(body).toEqual({ error: 'rate_limited' });
    expect(consumeOtp).not.toHaveBeenCalled();
  });
});
