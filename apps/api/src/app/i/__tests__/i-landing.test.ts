// GET /i/<importCode> landing route (S3a 可导入 QR target).
//
// The share card's QR encodes https://<host>/i/<importCode>. Before this route
// existed the QR landed on a 404 — WeChat "识别图中二维码" was a dead end. These
// tests pin that the route is actually SERVED and that the channel works:
//
//   - live code  → 200 text/html carrying the import deep link for the token
//                  (so the page can hand off to the native app)
//   - dead code  → 404 text/html ("分享已失效"), NOT a blank/JSON error
//   - rate limited → 429 BEFORE any resolve (shared per-IP brute-force guard
//                    with /api/share/resolve — no enumeration oracle)
//
// The resolver and rate limiter are mocked; this pins the HTTP contract of the
// landing route, not the DB.

const mockResolveImportCode = jest.fn();
jest.mock('@/lib/share-db', () => ({
  resolveImportCode: (...a: unknown[]) => mockResolveImportCode(...a),
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

import { NextRequest } from 'next/server';
import { GET as landing } from '@/app/i/[code]/route';
import { enforceRateLimits, clientIp } from '@/lib/rate-limit';

function reqOf(code: string) {
  return new NextRequest(`http://localhost/i/${code}`, { method: 'GET' });
}

function ctx(code: string) {
  return { params: Promise.resolve({ code }) };
}

beforeEach(() => {
  jest.clearAllMocks();
  (enforceRateLimits as jest.Mock).mockResolvedValue({ limited: false });
});

describe('GET /i/[code] landing route', () => {
  it('serves a 200 HTML page carrying the import deep link for a live code', async () => {
    mockResolveImportCode.mockResolvedValueOnce('tok_live_1');

    const res = await landing(reqOf('AB12CD'), ctx('AB12CD'));
    const body = await res.text();

    // The QR target is a REAL served route — not a 404.
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toMatch(/text\/html/);
    // The page must carry the deep link so it can hand off into the native app.
    expect(body).toContain('yummyornot://import/tok_live_1');
    // Resolved against the EXISTING importCode space (uppercased).
    expect(mockResolveImportCode).toHaveBeenCalledWith('AB12CD');
  });

  it('uppercases a lowercase code from the URL before resolving', async () => {
    mockResolveImportCode.mockResolvedValueOnce('tok_live_2');

    const res = await landing(reqOf('ab12cd'), ctx('ab12cd'));
    expect(res.status).toBe(200);
    expect(mockResolveImportCode).toHaveBeenCalledWith('AB12CD');
  });

  it('serves a 404 HTML page (not JSON/blank) when no live token derives to the code', async () => {
    mockResolveImportCode.mockResolvedValueOnce(null);

    const res = await landing(reqOf('DEADXX'), ctx('DEADXX'));
    const body = await res.text();

    expect(res.status).toBe(404);
    expect(res.headers.get('Content-Type')).toMatch(/text\/html/);
    // A friendly "share expired" page — never a raw deep link to a non-token.
    expect(body).toContain('分享已失效');
    expect(body).not.toContain('yummyornot://import/');
  });

  it('returns 429 BEFORE resolving when the IP is rate limited (no enumeration oracle)', async () => {
    (enforceRateLimits as jest.Mock).mockResolvedValue({ limited: true, retryAfterSeconds: 42 });

    const res = await landing(reqOf('AB12CD'), ctx('AB12CD'));

    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('42');
    // The brute-force guard short-circuits BEFORE any token lookup.
    expect(mockResolveImportCode).not.toHaveBeenCalled();
  });

  it('shares the same per-IP rate-limit bucket as /api/share/resolve', async () => {
    mockResolveImportCode.mockResolvedValueOnce('tok_live_3');

    await landing(reqOf('AB12CD'), ctx('AB12CD'));

    expect(enforceRateLimits).toHaveBeenCalledTimes(1);
    const rules = (enforceRateLimits as jest.Mock).mock.calls[0][0];
    expect(rules[0].scope).toBe('share:resolve:ip');
    expect(clientIp).toHaveBeenCalled();
  });
});
