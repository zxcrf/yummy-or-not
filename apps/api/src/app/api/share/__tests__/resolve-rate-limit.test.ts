// GET /api/share/resolve rate-limit guard (review翻修).
//
// The import code is only ~30 bits and resolveImportCode matches a guess against
// live tokens, so the anonymous resolver must be rate-limited per client IP
// (mirroring the OTP/login routes) or it is brute-forceable. These tests pin:
//   - when limited → 429 + Retry-After, and resolveImportCode is NEVER called
//     (no DB work, no enumeration oracle, no DoS amplification)
//   - when allowed → the resolver runs and the limiter was keyed on client IP
//
// Mirrors the otp-rate-limit.test.ts harness.

import { NextRequest } from 'next/server';

const mockResolveImportCode = jest.fn();
jest.mock('@/lib/share-db', () => ({
  resolveImportCode: (...a: unknown[]) => mockResolveImportCode(...a),
}));

jest.mock('@/lib/cors', () => ({
  withCors: (res: unknown) => res,
  corsPreflight: () => {
    const { NextResponse } = require('next/server');
    return new NextResponse(null, { status: 204 });
  },
}));

jest.mock('@/lib/rate-limit', () => ({
  clientIp: jest.fn(() => '203.0.113.7'),
  enforceRateLimits: jest.fn(),
  rateLimitedResponse: jest.fn((_origin: string | null, retryAfterSeconds: number) => {
    const { NextResponse } = require('next/server');
    const res = NextResponse.json({ error: 'rate_limited' }, { status: 429 });
    res.headers.set('Retry-After', String(retryAfterSeconds));
    return res;
  }),
}));

import { GET as resolve } from '@/app/api/share/resolve/route';
import { clientIp, enforceRateLimits } from '@/lib/rate-limit';

function reqOf(code: string) {
  return new NextRequest(`http://localhost/api/share/resolve?code=${code}`, { method: 'GET' });
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('GET /api/share/resolve rate limiting', () => {
  it('returns 429 BEFORE resolving the code when the IP is limited (no DB enumeration)', async () => {
    (enforceRateLimits as jest.Mock).mockResolvedValue({ limited: true, retryAfterSeconds: 42 });

    const res = await resolve(reqOf('ABC123'));
    const body = await res.json();

    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('42');
    expect(body).toEqual({ error: 'rate_limited' });
    // The brute-force guard must short-circuit BEFORE any token lookup.
    expect(mockResolveImportCode).not.toHaveBeenCalled();
  });

  it('keys the limiter on the client IP and resolves the code when allowed', async () => {
    (enforceRateLimits as jest.Mock).mockResolvedValue({ limited: false });
    mockResolveImportCode.mockResolvedValue('tok_live');

    const res = await resolve(reqOf('ABC123'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ token: 'tok_live' });

    // The limiter ran, scoped to the share-resolve IP bucket.
    expect(enforceRateLimits).toHaveBeenCalledTimes(1);
    const rules = (enforceRateLimits as jest.Mock).mock.calls[0][0];
    expect(rules[0].scope).toBe('share:resolve:ip');
    expect(clientIp).toHaveBeenCalled();
  });
});
