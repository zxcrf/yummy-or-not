import { NextRequest } from 'next/server';

jest.mock('@/lib/db', () => ({
  findUserByEmailWithHash: jest.fn(),
}));

jest.mock('@/lib/auth', () => ({
  verifyPassword: jest.fn(),
  normalizeEmail: jest.fn((email: string) => email.toLowerCase()),
  establishSession: jest.fn(),
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

import { POST } from '@/app/api/auth/login/route';
import { findUserByEmailWithHash } from '@/lib/db';
import { enforceRateLimits } from '@/lib/rate-limit';

function reqOf(body: object) {
  return new NextRequest('http://localhost/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('POST /api/auth/login rate limiting', () => {
  it('returns 429 and skips credential lookup when limited', async () => {
    (enforceRateLimits as jest.Mock).mockResolvedValue({
      limited: true,
      retryAfterSeconds: 120,
    });

    const res = await POST(reqOf({ email: 'A@X.COM', password: 'secret1' }));
    const body = await res.json();

    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('120');
    expect(body).toEqual({ error: 'rate_limited' });
    expect(findUserByEmailWithHash).not.toHaveBeenCalled();
  });
});
