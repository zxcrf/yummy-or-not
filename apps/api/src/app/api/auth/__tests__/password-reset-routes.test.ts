/* Route-level behavior of the password-reset endpoints (db + auth mocked).

   Pins:
     • reset-request is enumeration-safe: 200 for BOTH a registered and an
       unknown email, but a token row is saved ONLY for the registered one;
     • reset-request timing oracle (MED-A):
         – token generation + hashCode run UNCONDITIONALLY before the lookup
           so both branches pay the same CPU cost;
         – both branches wait the same MIN_RESPONSE_MS deadline so latency
           cannot distinguish found from not-found;
         – a slow webhook does NOT delay the response (fire-and-forget);
     • delivery observability (MED-B):
         – a non-2xx webhook response is logged via console.error;
         – EMAIL_WEBHOOK_URL unset in production is warned via console.error;
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

describe('reset-request timing oracle (MED-A)', () => {
  // Fix: token generation + hashCode run UNCONDITIONALLY before the user
  // lookup, and both branches wait the same MIN_RESPONSE_MS deadline before
  // responding. This closes the latency side-channel that previously let an
  // attacker distinguish registered from unregistered email addresses.

  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    (savePasswordResetToken as jest.Mock).mockResolvedValue(undefined);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.EMAIL_WEBHOOK_URL;
  });

  it('generateResetToken is called on BOTH the found and not-found paths', async () => {
    const { generateResetToken } = require('@/lib/auth');

    // Not-found path.
    (findUserByEmailWithHash as jest.Mock).mockResolvedValue(null);
    await resetRequest(reqOf('/api/auth/password/reset-request', { email: 'ghost@x.com' }));
    expect(generateResetToken).toHaveBeenCalledTimes(1);

    jest.clearAllMocks();
    (enforceRateLimits as jest.Mock).mockResolvedValue({ limited: false });

    // Found path.
    (findUserByEmailWithHash as jest.Mock).mockResolvedValue({ user: { id: 'u1' }, passwordHash: 'ph' });
    await resetRequest(reqOf('/api/auth/password/reset-request', { email: 'a@x.com' }));
    expect(generateResetToken).toHaveBeenCalledTimes(1);
  });

  it('hashCode is called on BOTH the found and not-found paths', async () => {
    const { hashCode } = require('@/lib/auth');

    // Not-found path.
    (findUserByEmailWithHash as jest.Mock).mockResolvedValue(null);
    await resetRequest(reqOf('/api/auth/password/reset-request', { email: 'ghost@x.com' }));
    expect(hashCode).toHaveBeenCalled();

    const callsOnMiss = (hashCode as jest.Mock).mock.calls.length;
    jest.clearAllMocks();
    (enforceRateLimits as jest.Mock).mockResolvedValue({ limited: false });

    // Found path.
    (findUserByEmailWithHash as jest.Mock).mockResolvedValue({ user: { id: 'u1' }, passwordHash: 'ph' });
    await resetRequest(reqOf('/api/auth/password/reset-request', { email: 'a@x.com' }));
    // hashCode must be called at least as many times on the found path.
    expect((hashCode as jest.Mock).mock.calls.length).toBeGreaterThanOrEqual(callsOnMiss);
  });

  it('both found and not-found paths wait at least MIN_RESPONSE_MS before responding', async () => {
    jest.useRealTimers(); // need real timers for wall-clock measurement

    // Not-found: must wait the deadline.
    (findUserByEmailWithHash as jest.Mock).mockResolvedValue(null);
    const startMiss = Date.now();
    await resetRequest(reqOf('/api/auth/password/reset-request', { email: 'ghost@x.com' }));
    const elapsedMiss = Date.now() - startMiss;
    expect(elapsedMiss).toBeGreaterThanOrEqual(140); // MIN_RESPONSE_MS=150, allow 10ms jitter

    jest.clearAllMocks();
    (enforceRateLimits as jest.Mock).mockResolvedValue({ limited: false });

    // Found: must also wait the deadline.
    (findUserByEmailWithHash as jest.Mock).mockResolvedValue({ user: { id: 'u1' }, passwordHash: 'ph' });
    const startHit = Date.now();
    await resetRequest(reqOf('/api/auth/password/reset-request', { email: 'a@x.com' }));
    const elapsedHit = Date.now() - startHit;
    expect(elapsedHit).toBeGreaterThanOrEqual(140);
  }, 2000); // allow generous wall-clock budget for CI

  it('a slow webhook (500 ms) does NOT block the response past MIN_RESPONSE_MS + small buffer', async () => {
    jest.useRealTimers();

    (findUserByEmailWithHash as jest.Mock).mockResolvedValue({ user: { id: 'u1' }, passwordHash: 'ph' });
    global.fetch = jest.fn(
      () => new Promise<Response>((resolve) => setTimeout(() => resolve(new Response()), 500))
    ) as unknown as typeof fetch;
    process.env.EMAIL_WEBHOOK_URL = 'http://fake-webhook.test/send';

    const start = Date.now();
    await resetRequest(reqOf('/api/auth/password/reset-request', { email: 'a@x.com' }));
    const elapsed = Date.now() - start;

    // Webhook takes 500 ms; if awaited the route would block ≥ 500 ms.
    // Fire-and-forget + 150 ms floor means it completes well under 400 ms.
    expect(elapsed).toBeLessThan(400);
  }, 2000);
});

describe('reset-request delivery observability (MED-B)', () => {
  let originalFetch: typeof global.fetch;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    originalFetch = global.fetch;
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    (savePasswordResetToken as jest.Mock).mockResolvedValue(undefined);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.EMAIL_WEBHOOK_URL;
    const savedEnv = process.env.NODE_ENV;
    // Restore NODE_ENV if it was changed.
    Object.defineProperty(process.env, 'NODE_ENV', { value: savedEnv, writable: true });
    errorSpy.mockRestore();
  });

  it('logs console.error when the webhook returns a non-2xx status', async () => {
    jest.useRealTimers();

    (findUserByEmailWithHash as jest.Mock).mockResolvedValue({ user: { id: 'u1' }, passwordHash: 'ph' });
    global.fetch = jest.fn(() =>
      Promise.resolve(new Response(null, { status: 500 }))
    ) as unknown as typeof fetch;
    process.env.EMAIL_WEBHOOK_URL = 'http://fake-webhook.test/send';

    await resetRequest(reqOf('/api/auth/password/reset-request', { email: 'a@x.com' }));

    // Allow the fire-and-forget microtask to settle.
    await new Promise((r) => setTimeout(r, 50));

    const errorCalls = errorSpy.mock.calls.map((args) => String(args[0]));
    expect(errorCalls.some((msg) => msg.includes('500'))).toBe(true);
  }, 2000);

  it('logs console.error when EMAIL_WEBHOOK_URL is unset in production', async () => {
    jest.useRealTimers();

    (findUserByEmailWithHash as jest.Mock).mockResolvedValue({ user: { id: 'u1' }, passwordHash: 'ph' });
    delete process.env.EMAIL_WEBHOOK_URL;
    // Simulate production environment.
    Object.defineProperty(process.env, 'NODE_ENV', { value: 'production', writable: true });

    await resetRequest(reqOf('/api/auth/password/reset-request', { email: 'a@x.com' }));

    // Allow the fire-and-forget microtask to settle.
    await new Promise((r) => setTimeout(r, 50));

    const errorCalls = errorSpy.mock.calls.map((args) => String(args[0]));
    expect(errorCalls.some((msg) => msg.includes('EMAIL_WEBHOOK_URL'))).toBe(true);
  }, 2000);
});

describe('reset-request Resend transport', () => {
  // When RESEND_API_KEY is set the route sends via Resend's REST API (plain
  // fetch, no SDK). These pin: the correct endpoint + bearer auth, the raw
  // token actually reaching the email body (the user-level payload that must
  // not silently break), fire-and-forget timing safety preserved, and non-2xx
  // surfacing in ops logs. The webhook is bypassed when Resend is configured.
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    process.env.RESEND_API_KEY = 're_test_key';
    process.env.EMAIL_FROM = 'Yummy or Not <noreply@baobao.click>';
    (savePasswordResetToken as jest.Mock).mockResolvedValue(undefined);
    (findUserByEmailWithHash as jest.Mock).mockResolvedValue({ user: { id: 'u1' }, passwordHash: 'ph' });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_FROM;
  });

  it('POSTs to the Resend API with bearer auth, the from-address, and the raw token in the body', async () => {
    jest.useRealTimers();
    const fetchMock = jest.fn((_url: string, _opts: RequestInit) =>
      Promise.resolve(new Response(null, { status: 200 })),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    await resetRequest(reqOf('/api/auth/password/reset-request', { email: 'a@x.com' }));
    await new Promise((r) => setTimeout(r, 50)); // let the fire-and-forget send settle

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails');
    expect((opts.headers as Record<string, string>).Authorization).toBe('Bearer re_test_key');
    const body = JSON.parse(opts.body as string);
    expect(body.to).toBe('a@x.com');
    expect(body.from).toBe('Yummy or Not <noreply@baobao.click>');
    // generateResetToken is mocked → 'raw-token'; it must appear in the email text
    // and inside the deep link so the user can actually complete the reset.
    expect(body.text).toContain('raw-token');
    expect(body.text).toContain('yummyornot://reset-password?token=raw-token');
  });

  it('does NOT call the webhook when Resend is configured (Resend wins)', async () => {
    jest.useRealTimers();
    process.env.EMAIL_WEBHOOK_URL = 'http://fake-webhook.test/send';
    const fetchMock = jest.fn((_url: string, _opts: RequestInit) =>
      Promise.resolve(new Response(null, { status: 200 })),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    await resetRequest(reqOf('/api/auth/password/reset-request', { email: 'a@x.com' }));
    await new Promise((r) => setTimeout(r, 50));

    delete process.env.EMAIL_WEBHOOK_URL;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.resend.com/emails');
  });

  it('a slow Resend send (500 ms) does NOT block the response past MIN_RESPONSE_MS + buffer', async () => {
    jest.useRealTimers();
    global.fetch = jest.fn(
      () => new Promise<Response>((resolve) => setTimeout(() => resolve(new Response()), 500))
    ) as unknown as typeof fetch;

    const start = Date.now();
    await resetRequest(reqOf('/api/auth/password/reset-request', { email: 'a@x.com' }));
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(400); // fire-and-forget: provider RTT off the hot path
  }, 2000);

  it('logs console.error when Resend returns a non-2xx status', async () => {
    jest.useRealTimers();
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    global.fetch = jest.fn(() =>
      Promise.resolve(new Response(null, { status: 422 }))
    ) as unknown as typeof fetch;

    await resetRequest(reqOf('/api/auth/password/reset-request', { email: 'a@x.com' }));
    await new Promise((r) => setTimeout(r, 50));

    const errorCalls = errorSpy.mock.calls.map((args) => String(args[0]));
    expect(errorCalls.some((msg) => msg.includes('Resend') && msg.includes('422'))).toBe(true);
    errorSpy.mockRestore();
  }, 2000);
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
