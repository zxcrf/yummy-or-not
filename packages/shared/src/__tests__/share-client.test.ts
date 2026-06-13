// Tests for the S3a share/import API-client functions (api-client.ts — NOT yet
// implemented, so these FAIL now and PASS once S3a lands).
//
//   mintShare(tasteId)        → POST /api/tastes/:id/share   → { token, deepLink, importCode, expiresAt }
//   getSharePreview(token)    → GET  /api/share/:token       → live preview + short presign
//   importShare(token)        → POST /api/share/:token/import → the new todo copy
//
// Pins the contract the mobile import landing depends on: correct method/path,
// auth header forwarding, and that a 410 surfaces as a machine-readable error
// (so the UI can show "this share is no longer available").

import { mintShare, getSharePreview, importShare, setAuthToken } from '../api-client';

let lastFetch: { url: string; init?: RequestInit } | null = null;

function mockJson(status: number, body: unknown) {
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    lastFetch = { url: typeof input === 'string' ? input : input.toString(), init };
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  lastFetch = null;
  setAuthToken('test-token');
});

describe('mintShare', () => {
  it('POSTs /api/tastes/:id/share and returns { token, deepLink, importCode, expiresAt }', async () => {
    mockJson(200, {
      token: 'tok1',
      deepLink: 'yummyornot://import/tok1',
      importCode: 'AB12CD',
      expiresAt: null,
    });

    const out = await mintShare('taste-9');
    expect(lastFetch?.url).toMatch(/\/api\/tastes\/taste-9\/share$/);
    expect(lastFetch?.init?.method).toBe('POST');
    // Auth header forwarded.
    const headers = new Headers(lastFetch?.init?.headers);
    expect(headers.get('Authorization')).toBe('Bearer test-token');

    expect(out.token).toBe('tok1');
    expect(out.deepLink).toBe('yummyornot://import/tok1');
    expect(out.importCode).toBe('AB12CD');
  });
});

describe('getSharePreview', () => {
  it('GETs /api/share/:token and returns the live preview payload', async () => {
    mockJson(200, { name: 'Boba LIVE', place: 'Tiger Sugar', verdict: 'yum', photoUrl: 'https://r2/x?sig=short' });
    const out = await getSharePreview('tok1');
    expect(lastFetch?.url).toMatch(/\/api\/share\/tok1$/);
    expect((lastFetch?.init?.method ?? 'GET')).toBe('GET');
    expect(out.name).toBe('Boba LIVE');
    expect(out.photoUrl).toBe('https://r2/x?sig=short');
  });

  it('a revoked/expired share (410) surfaces as a machine-readable error', async () => {
    mockJson(410, { error: 'share_gone' });
    await expect(getSharePreview('tokR')).rejects.toThrow('share_gone');
  });
});

describe('importShare', () => {
  it('POSTs /api/share/:token/import and returns the new todo copy', async () => {
    mockJson(201, { id: 'copy-1', status: 'todo', verdict: null, name: 'Brown Sugar Boba' });
    const out = await importShare('tok1');
    expect(lastFetch?.url).toMatch(/\/api\/share\/tok1\/import$/);
    expect(lastFetch?.init?.method).toBe('POST');
    expect(out.id).toBe('copy-1');
    expect(out.status).toBe('todo');
    expect(out.verdict).toBeNull();
  });
});
