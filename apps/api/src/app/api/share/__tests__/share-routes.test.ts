// Route-handler tests for S3a single-card share → import. The DB and storage
// layers are mocked; these pin the HTTP contract + security boundaries of the
// THIN-pointer share design (migration 0007):
//
//   POST /api/tastes/:id/share        — mint a thin token (owner-only)
//   GET  /api/share/:token            — live-read preview + SHORT (<=60s) presign
//   POST /api/share/:token/import     — copy-on-import into recipient to-taste
//   DELETE /api/tastes/:id/share      — owner revoke
//
// Required negatives (locked in docs/product/plans/share-and-circles.md §S3a):
//   - revoked / expired / source-deleted   → 410 Gone
//   - preview presign TTL <= 60s, and NOT re-issued after revoke
//   - owner cannot be impersonated (mint for someone else's taste → 404)
//   - import is decoupled (copies photo into importer namespace at import time)
//   - duplicate import is idempotent (UNIQUE(from_token, importer_id))
//   - NEVER forward the owner's raw presigned URL to the recipient
//
// These import the (not-yet-implemented) route modules, so they FAIL now and
// PASS once S3a lands. Follow the mock-DB harness from status-routes.test.ts.

// ── DB layer mocks (all S3a db helpers + the ones the route modules import) ──
const mockGetUserFromRequest = jest.fn();
const mockGetTaste = jest.fn();
const mockGetRawImage = jest.fn();
const mockCreateShareToken = jest.fn();
const mockGetShareToken = jest.fn();
const mockRevokeShareToken = jest.fn();
const mockImportSharedTaste = jest.fn();

// Storage: copy + presign. getSignedPhotoUrl is the SHORT-TTL preview presign;
// copyPhoto is the copy-on-import into the importer namespace.
const mockGetSignedPhotoUrl = jest.fn();
const mockCopyPhoto = jest.fn();

jest.mock('@/lib/auth', () => ({
  getUserFromRequest: (...args: unknown[]) => mockGetUserFromRequest(...args),
}));

jest.mock('@/lib/cors', () => ({
  corsPreflight: jest.fn(() => new Response(null, { status: 204 })),
  withCors: jest.fn((res: Response) => res),
}));

jest.mock('@/lib/db', () => ({
  getTaste: (...args: unknown[]) => mockGetTaste(...args),
  getRawImage: (...args: unknown[]) => mockGetRawImage(...args),
  createShareToken: (...args: unknown[]) => mockCreateShareToken(...args),
  getShareToken: (...args: unknown[]) => mockGetShareToken(...args),
  revokeShareToken: (...args: unknown[]) => mockRevokeShareToken(...args),
  importSharedTaste: (...args: unknown[]) => mockImportSharedTaste(...args),
}));

jest.mock('@/lib/storage', () => ({
  getSignedPhotoUrl: (...args: unknown[]) => mockGetSignedPhotoUrl(...args),
  copyPhoto: (...args: unknown[]) => mockCopyPhoto(...args),
  // PRESIGN_TTL_SECONDS is the 1h default; the share preview must use its own
  // <=60s TTL, so the route must NOT reuse this value.
  PRESIGN_TTL_SECONDS: 3600,
}));

import { NextRequest } from 'next/server';

// Route modules under test (do NOT exist yet — RED).
import { POST as mintShare, DELETE as revokeShare } from '@/app/api/tastes/[id]/share/route';
import { GET as previewShare } from '@/app/api/share/[token]/route';
import { POST as importShare } from '@/app/api/share/[token]/import/route';

// ── helpers ─────────────────────────────────────────────────────────────────

function jsonReq(method: string, url: string, body?: unknown): NextRequest {
  return new NextRequest(url, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

async function bodyOf(res: Response): Promise<Record<string, unknown>> {
  return JSON.parse(await res.text());
}

const idCtx = (id: string) => ({ params: Promise.resolve({ id }) });
const tokenCtx = (token: string) => ({ params: Promise.resolve({ token }) });

const owner = { id: 'owner-1', plan: 'free' };
const recipient = { id: 'recip-2', plan: 'free' };

// A live source taste owned by owner-1. getTaste returns the resolved Taste.
function makeSource(overrides: Record<string, unknown> = {}) {
  return {
    id: 'src-taste',
    name: 'Brown Sugar Boba',
    place: 'Tiger Sugar',
    price: '5.80',
    status: 'tasted',
    verdict: 'yum',
    tags: ['Boba'],
    notes: 'great',
    imageKey: 't/abc/orig.jpg',
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetUserFromRequest.mockResolvedValue(owner);
});

// ── POST /api/tastes/:id/share — mint ─────────────────────────────────────────

describe('POST /api/tastes/:id/share (mint thin token, owner-only)', () => {
  it('mints a thin token for an owned taste → { token, deepLink, importCode, expiresAt }', async () => {
    mockGetTaste.mockResolvedValue(makeSource());
    mockCreateShareToken.mockResolvedValue({
      token: 'tok_abcdef123456',
      tasteId: 'src-taste',
      ownerId: 'owner-1',
      revoked: false,
      expiresAt: '2026-07-13T00:00:00.000Z',
    });

    const res = await mintShare(jsonReq('POST', 'http://localhost/api/tastes/src-taste/share'), idCtx('src-taste'));
    expect(res.status).toBe(200);
    const body = await bodyOf(res);

    expect(typeof body.token).toBe('string');
    expect(body.deepLink).toBe('yummyornot://import/tok_abcdef123456');
    // import code is short + token-derived (not the full token).
    // CODE_LENGTH=10 since the 0008 security fix (bumped from 6 for ~49.5 bits).
    expect(typeof body.importCode).toBe('string');
    expect((body.importCode as string).length).toBe(10);
    expect(body.importCode).not.toBe(body.token);
    expect(body).toHaveProperty('expiresAt');

    // Mint writes ONE thin pointer row owned by the caller — no jsonb snapshot,
    // no photo copy at mint time.
    expect(mockCreateShareToken).toHaveBeenCalledWith(
      expect.objectContaining({ tasteId: 'src-taste', ownerId: 'owner-1' }),
    );
    expect(mockCopyPhoto).not.toHaveBeenCalled();
  });

  it('cannot mint a share for a taste the caller does not own → 404, no token written', async () => {
    // getTaste(userId,id) is ownership-scoped; a non-owned id resolves to null.
    mockGetTaste.mockResolvedValue(null);

    const res = await mintShare(jsonReq('POST', 'http://localhost/api/tastes/someone-elses/share'), idCtx('someone-elses'));
    expect(res.status).toBe(404);
    expect(mockCreateShareToken).not.toHaveBeenCalled();
  });

  it('rejects an unauthenticated caller → 401', async () => {
    mockGetUserFromRequest.mockResolvedValue(null);
    const res = await mintShare(jsonReq('POST', 'http://localhost/api/tastes/src-taste/share'), idCtx('src-taste'));
    expect(res.status).toBe(401);
    expect(mockCreateShareToken).not.toHaveBeenCalled();
  });
});

// ── GET /api/share/:token — preview (live read + short presign) ───────────────

describe('GET /api/share/:token (live preview + short presign)', () => {
  // Anyone (even logged-out) can preview via the token; auth is the token itself.
  beforeEach(() => {
    mockGetUserFromRequest.mockResolvedValue(null);
  });

  it('valid token → live-reads source + mints a SHORT (<=60s) presign of the ORIGINAL object', async () => {
    mockGetShareToken.mockResolvedValue({
      token: 'tok1', tasteId: 'src-taste', ownerId: 'owner-1', revoked: false, expiresAt: null,
    });
    // live read of the source row (NOT a stored snapshot)
    mockGetTaste.mockResolvedValue(makeSource({ name: 'Boba LIVE' }));
    mockGetRawImage.mockResolvedValue('t/abc/orig.jpg');
    mockGetSignedPhotoUrl.mockResolvedValue('https://r2.example.com/t/abc/orig.jpg?X-Amz-Signature=short');

    const res = await previewShare(jsonReq('GET', 'http://localhost/api/share/tok1'), tokenCtx('tok1'));
    expect(res.status).toBe(200);
    const body = await bodyOf(res);

    // Preview reflects the LIVE source (no jsonb snapshot at mint).
    expect(body.name).toBe('Boba LIVE');

    // Presign TTL must be short — <=60s — NOT the 1h PRESIGN_TTL_SECONDS default.
    expect(mockGetSignedPhotoUrl).toHaveBeenCalledTimes(1);
    const ttlArg = mockGetSignedPhotoUrl.mock.calls[0][1] as number;
    expect(ttlArg).toBeLessThanOrEqual(60);
    expect(ttlArg).toBeGreaterThan(0);

    // The preview gives a freshly-minted presign, not a forwarded owner URL.
    expect(typeof body.photoUrl).toBe('string');
  });

  it('revoked token → 410 Gone, and NO presign is minted', async () => {
    mockGetShareToken.mockResolvedValue({
      token: 'tokR', tasteId: 'src-taste', ownerId: 'owner-1', revoked: true, expiresAt: null,
    });

    const res = await previewShare(jsonReq('GET', 'http://localhost/api/share/tokR'), tokenCtx('tokR'));
    expect(res.status).toBe(410);
    // Revoke stops issuing presigns immediately.
    expect(mockGetSignedPhotoUrl).not.toHaveBeenCalled();
  });

  it('expired token → 410 Gone, and NO presign is minted', async () => {
    mockGetShareToken.mockResolvedValue({
      token: 'tokE', tasteId: 'src-taste', ownerId: 'owner-1', revoked: false,
      expiresAt: '2000-01-01T00:00:00.000Z', // in the past
    });

    const res = await previewShare(jsonReq('GET', 'http://localhost/api/share/tokE'), tokenCtx('tokE'));
    expect(res.status).toBe(410);
    expect(mockGetSignedPhotoUrl).not.toHaveBeenCalled();
  });

  it('source taste deleted (token valid but row gone) → 410 Gone', async () => {
    mockGetShareToken.mockResolvedValue({
      token: 'tokD', tasteId: 'gone', ownerId: 'owner-1', revoked: false, expiresAt: null,
    });
    mockGetTaste.mockResolvedValue(null); // ON DELETE CASCADE may also remove the token; either way: 410

    const res = await previewShare(jsonReq('GET', 'http://localhost/api/share/tokD'), tokenCtx('tokD'));
    expect(res.status).toBe(410);
    expect(mockGetSignedPhotoUrl).not.toHaveBeenCalled();
  });

  it('unknown token → 410 Gone (not a 404 enumeration oracle)', async () => {
    mockGetShareToken.mockResolvedValue(null);
    const res = await previewShare(jsonReq('GET', 'http://localhost/api/share/bogus'), tokenCtx('bogus'));
    expect(res.status).toBe(410);
    expect(mockGetSignedPhotoUrl).not.toHaveBeenCalled();
  });

  it('legacy ABSOLUTE-URL image (e.g. a stored long-lived presigned R2 URL) → photoless preview, NEVER forwarded', async () => {
    // If the image column holds a full https:// presigned URL (1h TTL), the
    // route must NOT forward it verbatim — that would survive revocation for up
    // to an hour. The safe behavior: return '' (photoless) and mint nothing.
    mockGetShareToken.mockResolvedValue({
      token: 'tokL', tasteId: 'src-taste', ownerId: 'owner-1', revoked: false, expiresAt: null,
    });
    mockGetTaste.mockResolvedValue(makeSource());
    mockGetRawImage.mockResolvedValue(
      'https://r2.example.com/owner/secret.jpg?X-Amz-Signature=LONGLIVED&X-Amz-Expires=3600',
    );

    const res = await previewShare(jsonReq('GET', 'http://localhost/api/share/tokL'), tokenCtx('tokL'));
    expect(res.status).toBe(200);
    const body = await bodyOf(res);

    // Photoless preview — the owner's long-lived URL is never handed out.
    expect(body.photoUrl).toBe('');
    expect(JSON.stringify(body)).not.toContain('X-Amz-Signature');
    // And no presign was minted for an absolute-URL source.
    expect(mockGetSignedPhotoUrl).not.toHaveBeenCalled();
  });

  it('NEVER forwards the owner raw presigned URL — preview presign is minted fresh by the API gate', async () => {
    // If a presign were forwarded verbatim, getSignedPhotoUrl would NOT be
    // called by the preview route. This asserts the route mints its own.
    mockGetShareToken.mockResolvedValue({
      token: 'tok2', tasteId: 'src-taste', ownerId: 'owner-1', revoked: false, expiresAt: null,
    });
    mockGetTaste.mockResolvedValue(makeSource());
    mockGetRawImage.mockResolvedValue('t/abc/orig.jpg');
    mockGetSignedPhotoUrl.mockResolvedValue('https://r2.example.com/fresh?X-Amz-Signature=fresh');

    await previewShare(jsonReq('GET', 'http://localhost/api/share/tok2'), tokenCtx('tok2'));
    expect(mockGetSignedPhotoUrl).toHaveBeenCalledTimes(1);
  });
});

// ── revoke then preview — presign no longer issued ────────────────────────────

describe('revoke stops presign issuance immediately', () => {
  it('DELETE /api/tastes/:id/share revokes (owner-only); a later GET preview returns 410 and mints no presign', async () => {
    // 1) owner revokes
    mockGetUserFromRequest.mockResolvedValue(owner);
    mockRevokeShareToken.mockResolvedValue(true);
    const delRes = await revokeShare(jsonReq('DELETE', 'http://localhost/api/tastes/src-taste/share'), idCtx('src-taste'));
    expect(delRes.status).toBe(200);
    expect(mockRevokeShareToken).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId: 'owner-1', tasteId: 'src-taste' }),
    );

    // 2) preview after revoke → DB now reports revoked → 410, no presign
    mockGetUserFromRequest.mockResolvedValue(null);
    mockGetShareToken.mockResolvedValue({
      token: 'tok1', tasteId: 'src-taste', ownerId: 'owner-1', revoked: true, expiresAt: null,
    });
    const getRes = await previewShare(jsonReq('GET', 'http://localhost/api/share/tok1'), tokenCtx('tok1'));
    expect(getRes.status).toBe(410);
    expect(mockGetSignedPhotoUrl).not.toHaveBeenCalled();
  });

  it('a non-owner cannot revoke someone else\'s share → 404/403, revoke not applied', async () => {
    mockGetUserFromRequest.mockResolvedValue(recipient); // not the owner
    // revokeShareToken is owner-scoped: it reports "nothing revoked" for a
    // non-owner. The route must not 200.
    mockRevokeShareToken.mockResolvedValue(false);
    const res = await revokeShare(jsonReq('DELETE', 'http://localhost/api/tastes/src-taste/share'), idCtx('src-taste'));
    expect([403, 404]).toContain(res.status);
  });
});

// ── POST /api/share/:token/import — copy-on-import, decoupled, idempotent ──────

describe('POST /api/share/:token/import (copy-on-import into recipient to-taste)', () => {
  beforeEach(() => {
    mockGetUserFromRequest.mockResolvedValue(recipient);
  });

  it('imports → creates a todo row with verdict=null, copies photo into importer namespace, writes provenance', async () => {
    mockGetShareToken.mockResolvedValue({
      token: 'tokI', tasteId: 'src-taste', ownerId: 'owner-1', revoked: false, expiresAt: null,
    });
    mockGetTaste.mockResolvedValue(makeSource());
    mockGetRawImage.mockResolvedValue('t/abc/orig.jpg');
    // importSharedTaste does the transactional copy + insert + taste_imports write.
    mockImportSharedTaste.mockResolvedValue({
      created: true,
      taste: { id: 'copy-1', status: 'todo', verdict: null, name: 'Brown Sugar Boba' },
    });

    const res = await importShare(jsonReq('POST', 'http://localhost/api/share/tokI/import'), tokenCtx('tokI'));
    expect(res.status).toBe(201);
    const body = await bodyOf(res);
    expect(body.status).toBe('todo');
    expect(body.verdict).toBeNull();

    // The import is performed for the logged-in recipient, against this token.
    expect(mockImportSharedTaste).toHaveBeenCalledWith(
      expect.objectContaining({ token: 'tokI', importerId: 'recip-2' }),
    );
  });

  it('imported copy is DECOUPLED from source: mutating/deleting the source after import does not change the copy', async () => {
    // First import returns a concrete copy snapshot.
    mockGetShareToken.mockResolvedValue({
      token: 'tokI', tasteId: 'src-taste', ownerId: 'owner-1', revoked: false, expiresAt: null,
    });
    mockGetTaste.mockResolvedValue(makeSource({ name: 'Original Name', imageKey: 't/abc/orig.jpg' }));
    mockGetRawImage.mockResolvedValue('t/abc/orig.jpg');
    mockImportSharedTaste.mockResolvedValue({
      created: true,
      taste: { id: 'copy-1', status: 'todo', verdict: null, name: 'Original Name', imageKey: 'recip-2/copy/orig.jpg' },
    });

    const res = await importShare(jsonReq('POST', 'http://localhost/api/share/tokI/import'), tokenCtx('tokI'));
    const body = await bodyOf(res);

    // The copy carries its OWN importer-namespaced photo key (copy-on-import),
    // NOT the owner's original key — so a later source delete cannot orphan it.
    expect(body.imageKey).not.toBe('t/abc/orig.jpg');
    expect(String(body.imageKey)).toContain('recip-2');
    // The copy's name is the value captured at import; the source can change
    // afterward without the import route re-reading it (snapshot at import).
    expect(body.name).toBe('Original Name');
  });

  it('duplicate import of the same token by the same user is idempotent (UNIQUE) → returns the existing copy, no second insert', async () => {
    mockGetShareToken.mockResolvedValue({
      token: 'tokI', tasteId: 'src-taste', ownerId: 'owner-1', revoked: false, expiresAt: null,
    });
    mockGetTaste.mockResolvedValue(makeSource());
    mockGetRawImage.mockResolvedValue('t/abc/orig.jpg');
    // Second time: UNIQUE(from_token, importer_id) hit → created:false, existing copy.
    mockImportSharedTaste.mockResolvedValue({
      created: false,
      taste: { id: 'copy-1', status: 'todo', verdict: null, name: 'Brown Sugar Boba' },
    });

    const res = await importShare(jsonReq('POST', 'http://localhost/api/share/tokI/import'), tokenCtx('tokI'));
    // Idempotent: a 200 (already exists) is acceptable, and the SAME copy id is returned.
    expect([200, 201]).toContain(res.status);
    const body = await bodyOf(res);
    expect(body.id).toBe('copy-1');
  });

  it('import via a revoked token → 410 Gone, no copy performed', async () => {
    mockGetShareToken.mockResolvedValue({
      token: 'tokR', tasteId: 'src-taste', ownerId: 'owner-1', revoked: true, expiresAt: null,
    });
    const res = await importShare(jsonReq('POST', 'http://localhost/api/share/tokR/import'), tokenCtx('tokR'));
    expect(res.status).toBe(410);
    expect(mockImportSharedTaste).not.toHaveBeenCalled();
  });

  it('import requires a logged-in user → 401 when anonymous', async () => {
    mockGetUserFromRequest.mockResolvedValue(null);
    mockGetShareToken.mockResolvedValue({
      token: 'tokI', tasteId: 'src-taste', ownerId: 'owner-1', revoked: false, expiresAt: null,
    });
    const res = await importShare(jsonReq('POST', 'http://localhost/api/share/tokI/import'), tokenCtx('tokI'));
    expect(res.status).toBe(401);
    expect(mockImportSharedTaste).not.toHaveBeenCalled();
  });
});
