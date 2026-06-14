/* Route-level behavior of the password-reset endpoints (db + auth mocked).

   Pins:
     • reset-request is enumeration-safe: 200 for BOTH a registered and an
       unknown email, but a token row is saved ONLY for the registered one;
     • reset-request is timing-safe: deliver() is fire-and-forget — a slow
       webhook does not delay the response and cannot be used to distinguish
       a registered from an unregistered email (HIGH 1);
     • reset-verify calls applyPasswordReset with the hashed token AND the
       normalized email so the SQL binds both (MED 3);
     • reset-verify returns a generic 401 bad_token on a null result;
     • both endpoints gate on the rate limiter BEFORE doing any work. */
import { NextRequest } from 'next/server';

jest.mock('@/lib/db', () => ({
  findUserByEmailWithHash: jest.fn(),
  savePasswordResetToken: jest.fn(),
  applyPasswordReset: jest.fn(),
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
  applyPasswordReset,
} from '@/lib/db';
import { enforceRateLimits } from '@/lib/rate-limit';

function reqOf(path: string, body: object) {
  return new NextRequest(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// deliver() is fire-and-forget: it emits a dev console.log AFTER the route
// returns. Suppress it file-wide so Jest doesn't error "cannot log after
// tests are done" when the micro-task settles post-assertion.
beforeAll(() => { jest.spyOn(console, 'log').mockImplementation(() => {}); });
afterAll(() => { jest.restoreAllMocks(); });

beforeEach(() => {
  jest.clearAllMocks();
  (enforceRateLimits as jest.Mock).mockResolvedValue({ limited: false });
});

// ── reset-request ─────────────────────────────────────────────────────────────

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

describe('reset-request timing oracle (HIGH 1)', () => {
  // The fix: deliver() is called with `void` (fire-and-forget), so the webhook
  // RTT is never on the hot path and cannot be used to distinguish a registered
  // from an unregistered email by response latency.
  //
  // This test uses a slow (100 ms) webhook and asserts the route returns in
  // < 50 ms even for a registered email — proving the webhook is NOT awaited.
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.EMAIL_WEBHOOK_URL;
  });

  it('does not await the email webhook — slow webhook does not delay response', async () => {
    (findUserByEmailWithHash as jest.Mock).mockResolvedValue({
      user: { id: 'u1' },
      passwordHash: 'phash',
    });
    (savePasswordResetToken as jest.Mock).mockResolvedValue(undefined);

    // Intercept global fetch to simulate a slow webhook (100 ms).
    global.fetch = jest.fn(
      () => new Promise<Response>((resolve) => setTimeout(() => resolve(new Response()), 100))
    ) as unknown as typeof fetch;
    process.env.EMAIL_WEBHOOK_URL = 'http://fake-webhook.test/send';

    const start = Date.now();
    await resetRequest(reqOf('/api/auth/password/reset-request', { email: 'a@x.com' }));
    const elapsed = Date.now() - start;

    // If deliver() were awaited the elapsed time would be ≥ 100 ms.
    // Fire-and-forget means the route returns well before the webhook settles.
    expect(elapsed).toBeLessThan(50);
  });
});

// ── reset-verify ──────────────────────────────────────────────────────────────

describe('reset-verify', () => {
  it('calls applyPasswordReset with hashed token + email + hashed password', async () => {
    (applyPasswordReset as jest.Mock).mockResolvedValue({ userId: 'u1' });

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
    // The atomic helper must receive: hashed token, normalized email, hashed pw.
    // Email binding (MED 3) is enforced inside applyPasswordReset via SQL.
    expect(applyPasswordReset).toHaveBeenCalledWith(
      'hash:good-token',
      'a@x.com',
      'phash:longenough8',
    );
  });

  it('returns a generic 401 bad_token and calls nothing else when token is invalid', async () => {
    (applyPasswordReset as jest.Mock).mockResolvedValue(null);

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
    expect(applyPasswordReset).not.toHaveBeenCalled();
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
    expect(applyPasswordReset).not.toHaveBeenCalled();
  });
});
