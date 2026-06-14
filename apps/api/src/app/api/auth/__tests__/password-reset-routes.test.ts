/* Route-level behavior of the password-reset endpoints (db + auth mocked).

   Pins:
     • reset-request is enumeration-safe: 200 for BOTH a registered and an
       unknown email, but a token row is saved ONLY for the registered one;
     • reset-verify revokes sessions + sets the new hash on a good token, and
       returns a generic 401 bad_token on a bad one;
     • both endpoints gate on the rate limiter BEFORE doing any work. */
import { NextRequest } from 'next/server';

jest.mock('@/lib/db', () => ({
  findUserByEmailWithHash: jest.fn(),
  savePasswordResetToken: jest.fn(),
  consumePasswordResetToken: jest.fn(),
  setUserPasswordHash: jest.fn(),
  deleteUserSessions: jest.fn(),
}));

jest.mock('@/lib/auth', () => ({
  generateResetToken: jest.fn(() => 'raw-token'),
  hashCode: jest.fn((code: string) => `hash:${code}`),
  hashPassword: jest.fn((pw: string) => `phash:${pw}`),
  normalizeEmail: jest.fn((email: string) => email.trim().toLowerCase()),
  isValidEmail: jest.fn(() => true),
  PW_RESET_TTL_MS: 1_800_000,
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

import { POST as resetRequest } from '@/app/api/auth/password/reset-request/route';
import { POST as resetVerify } from '@/app/api/auth/password/reset-verify/route';
import {
  findUserByEmailWithHash,
  savePasswordResetToken,
  consumePasswordResetToken,
  setUserPasswordHash,
  deleteUserSessions,
} from '@/lib/db';
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
  (enforceRateLimits as jest.Mock).mockResolvedValue({ limited: false });
});

describe('reset-request (enumeration-safe)', () => {
  it('returns 200 AND saves a token row when the email is registered', async () => {
    (findUserByEmailWithHash as jest.Mock).mockResolvedValue({
      user: { id: 'u1' },
      passwordHash: 'phash',
    });

    const res = await resetRequest(reqOf('/api/auth/password/reset-request', { email: 'a@x.com' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(savePasswordResetToken).toHaveBeenCalledTimes(1);
    expect(savePasswordResetToken).toHaveBeenCalledWith(
      'u1',
      'a@x.com',
      'hash:raw-token', // stored hashed, never the raw token
      expect.any(Date),
    );
  });

  it('returns the SAME 200 for an unknown email but saves NO token (no enumeration)', async () => {
    (findUserByEmailWithHash as jest.Mock).mockResolvedValue(null);

    const res = await resetRequest(reqOf('/api/auth/password/reset-request', { email: 'ghost@x.com' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(savePasswordResetToken).not.toHaveBeenCalled();
  });

  it('gates on the rate limiter before looking up the user', async () => {
    (enforceRateLimits as jest.Mock).mockResolvedValue({ limited: true, retryAfterSeconds: 90 });

    const res = await resetRequest(reqOf('/api/auth/password/reset-request', { email: 'a@x.com' }));

    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('90');
    expect(findUserByEmailWithHash).not.toHaveBeenCalled();
    expect(savePasswordResetToken).not.toHaveBeenCalled();
  });
});

describe('reset-verify', () => {
  it('sets the new hash and revokes sessions for a valid token', async () => {
    (consumePasswordResetToken as jest.Mock).mockResolvedValue({ userId: 'u1' });

    const res = await resetVerify(
      reqOf('/api/auth/password/reset-verify', {
        email: 'a@x.com',
        token: 'good-token',
        newPassword: 'longenough8',
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(consumePasswordResetToken).toHaveBeenCalledWith('hash:good-token');
    expect(setUserPasswordHash).toHaveBeenCalledWith('u1', 'phash:longenough8');
    expect(deleteUserSessions).toHaveBeenCalledWith('u1');
  });

  it('returns a generic 401 bad_token and changes nothing for a bad token', async () => {
    (consumePasswordResetToken as jest.Mock).mockResolvedValue(null);

    const res = await resetVerify(
      reqOf('/api/auth/password/reset-verify', {
        email: 'a@x.com',
        token: 'bad-token',
        newPassword: 'longenough8',
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body).toEqual({ error: 'bad_token' });
    expect(setUserPasswordHash).not.toHaveBeenCalled();
    expect(deleteUserSessions).not.toHaveBeenCalled();
  });

  it('rejects a too-short new password before consuming the token', async () => {
    const res = await resetVerify(
      reqOf('/api/auth/password/reset-verify', {
        email: 'a@x.com',
        token: 'good-token',
        newPassword: 'short',
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body).toEqual({ error: 'weak_password' });
    expect(consumePasswordResetToken).not.toHaveBeenCalled();
  });

  it('gates on the rate limiter before consuming the token', async () => {
    (enforceRateLimits as jest.Mock).mockResolvedValue({ limited: true, retryAfterSeconds: 42 });

    const res = await resetVerify(
      reqOf('/api/auth/password/reset-verify', {
        email: 'a@x.com',
        token: 'good-token',
        newPassword: 'longenough8',
      }),
    );

    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('42');
    expect(consumePasswordResetToken).not.toHaveBeenCalled();
  });
});
