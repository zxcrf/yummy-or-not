// Regression — OAuth callback redirects to native deep link, not deleted web origin.
//
// Finding (CRITICAL): callback route redirected to APP_WEB_URL (deleted web
// origin) and delivered the token in a URL fragment. With the web app gone,
// this made OAuth login completely broken on iOS/Android.
//
// Fix: callback redirects to `yummyornot://auth/callback?token=<token>`
// (or `?auth_error=<reason>` on failure). APP_NATIVE_SCHEME env var controls
// the scheme; defaults to "yummyornot".
//
// Also covers the initiate route: provider-unavailable now returns a structured
// JSON 400 instead of redirecting to the deleted web origin.

import { NextRequest } from 'next/server';

jest.mock('@/lib/oauth', () => ({
  getProvider: jest.fn(),
  isConfigured: jest.fn(),
  exchangeCode: jest.fn(),
  buildAuthorizeUrl: jest.fn(),
}));

jest.mock('@/lib/db', () => ({
  findOrCreateUserByOAuth: jest.fn(),
  createSession: jest.fn(),
}));

jest.mock('@/lib/auth', () => ({
  generateSessionToken: jest.fn(() => 'test-token-abc'),
  setSessionCookie: jest.fn(),
  SESSION_TTL_MS: 86400000,
}));

import { GET as callbackGET } from '@/app/api/auth/oauth/[provider]/callback/route';
import { GET as initiateGET } from '@/app/api/auth/oauth/[provider]/route';
import {
  getProvider,
  isConfigured,
  exchangeCode,
  buildAuthorizeUrl,
} from '@/lib/oauth';
import { findOrCreateUserByOAuth, createSession } from '@/lib/db';

const mockGetProvider = getProvider as jest.Mock;
const mockIsConfigured = isConfigured as jest.Mock;
const mockExchangeCode = exchangeCode as jest.Mock;
const mockBuildAuthorizeUrl = buildAuthorizeUrl as jest.Mock;
const mockFindOrCreate = findOrCreateUserByOAuth as jest.Mock;
const mockCreateSession = createSession as jest.Mock;

function makeCallbackRequest(params: Record<string, string>, cookies: Record<string, string> = {}) {
  const url = new URL(`https://api.example.com/api/auth/oauth/google/callback`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const req = new NextRequest(url.toString());
  // Attach cookies by patching the cookies getter
  Object.defineProperty(req, 'cookies', {
    value: {
      get: (name: string) => cookies[name] ? { value: cookies[name] } : undefined,
      set: jest.fn(),
    },
  });
  return req;
}

function makeInitiateRequest() {
  return new NextRequest('https://api.example.com/api/auth/oauth/google');
}

const ctx = { params: Promise.resolve({ provider: 'google' }) };

// ── callback route tests ──────────────────────────────────────────────────────

describe('OAuth callback — redirects to native deep link (finding: web origin redirect broken)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.APP_NATIVE_SCHEME;
  });

  it('redirects success to yummyornot://auth/callback?token=... (default scheme)', async () => {
    const fakeProvider = { id: 'google' };
    mockGetProvider.mockReturnValue(fakeProvider);
    mockIsConfigured.mockReturnValue(true);
    mockExchangeCode.mockResolvedValue({ sub: 'g-123', email: 'u@g.com', name: 'U' });
    mockFindOrCreate.mockResolvedValue({ id: 'user-1' });
    mockCreateSession.mockResolvedValue(undefined);

    const req = makeCallbackRequest(
      { code: 'auth-code', state: 'csrf-state' },
      { yon_oauth_state_google: 'csrf-state' },
    );
    const res = await callbackGET(req, ctx);

    expect(res.status).toBe(307);
    const location = res.headers.get('location') ?? '';
    expect(location).toMatch(/^yummyornot:\/\/auth\/callback\?token=test-token-abc/);
    // Must NOT redirect to any http(s) web origin
    expect(location).not.toMatch(/^https?:\/\//);
  });

  it('respects APP_NATIVE_SCHEME env override', async () => {
    process.env.APP_NATIVE_SCHEME = 'myapp';
    const fakeProvider = { id: 'google' };
    mockGetProvider.mockReturnValue(fakeProvider);
    mockIsConfigured.mockReturnValue(true);
    mockExchangeCode.mockResolvedValue({ sub: 'g-456', email: 'b@g.com', name: 'B' });
    mockFindOrCreate.mockResolvedValue({ id: 'user-2' });
    mockCreateSession.mockResolvedValue(undefined);

    const req = makeCallbackRequest(
      { code: 'code2', state: 'state2' },
      { yon_oauth_state_google: 'state2' },
    );
    const res = await callbackGET(req, ctx);

    const location = res.headers.get('location') ?? '';
    expect(location).toMatch(/^myapp:\/\/auth\/callback\?token=/);
  });

  it('redirects failure to yummyornot://auth/callback?auth_error=... (CSRF mismatch)', async () => {
    mockGetProvider.mockReturnValue({ id: 'google' });
    mockIsConfigured.mockReturnValue(true);

    const req = makeCallbackRequest(
      { code: 'code', state: 'wrong-state' },
      { yon_oauth_state_google: 'expected-state' },
    );
    const res = await callbackGET(req, ctx);

    expect(res.status).toBe(307);
    const location = res.headers.get('location') ?? '';
    expect(location).toMatch(/^yummyornot:\/\/auth\/callback\?auth_error=oauth_state/);
    expect(location).not.toMatch(/^https?:\/\//);
  });

  it('redirects provider_unavailable to deep link error (not web origin)', async () => {
    mockGetProvider.mockReturnValue(null);
    mockIsConfigured.mockReturnValue(false);

    const req = makeCallbackRequest({ code: 'c', state: 's' });
    const res = await callbackGET(req, ctx);

    expect(res.status).toBe(307);
    const location = res.headers.get('location') ?? '';
    expect(location).toMatch(/^yummyornot:\/\/auth\/callback\?auth_error=provider_unavailable/);
    expect(location).not.toMatch(/^https?:\/\//);
  });

  it('token is delivered in query string, not URL fragment', async () => {
    const fakeProvider = { id: 'google' };
    mockGetProvider.mockReturnValue(fakeProvider);
    mockIsConfigured.mockReturnValue(true);
    mockExchangeCode.mockResolvedValue({ sub: 'g-789', email: 'c@g.com', name: 'C' });
    mockFindOrCreate.mockResolvedValue({ id: 'user-3' });
    mockCreateSession.mockResolvedValue(undefined);

    const req = makeCallbackRequest(
      { code: 'code3', state: 'state3' },
      { yon_oauth_state_google: 'state3' },
    );
    const res = await callbackGET(req, ctx);

    const location = res.headers.get('location') ?? '';
    // Token must be in the query string (before any #), not in a fragment.
    const [beforeFragment] = location.split('#');
    expect(beforeFragment).toContain('token=test-token-abc');
    // No fragment used
    expect(location).not.toContain('#token=');
  });
});

// ── initiate route tests ──────────────────────────────────────────────────────

describe('OAuth initiate — provider_unavailable returns JSON 400 (finding: redirect to deleted web origin)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.APP_WEB_URL;
  });

  it('returns 400 JSON when provider is unavailable (not a redirect)', async () => {
    mockGetProvider.mockReturnValue(null);
    mockIsConfigured.mockReturnValue(false);

    const req = makeInitiateRequest();
    const res = await initiateGET(req, ctx);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ error: 'provider_unavailable' });
    // Must NOT be a redirect to any origin
    expect(res.headers.get('location')).toBeNull();
  });

  it('redirects to provider authorize URL when configured', async () => {
    const fakeProvider = { id: 'google' };
    mockGetProvider.mockReturnValue(fakeProvider);
    mockIsConfigured.mockReturnValue(true);
    mockBuildAuthorizeUrl.mockReturnValue('https://accounts.google.com/o/oauth2/auth?...');

    const req = makeInitiateRequest();
    const res = await initiateGET(req, ctx);

    expect(res.status).toBe(307);
    const location = res.headers.get('location') ?? '';
    expect(location).toContain('accounts.google.com');
  });
});
