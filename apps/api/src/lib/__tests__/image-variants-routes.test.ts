/* ============================================================
   Integration tests for image-variant routes + resolvePhotoUrls.

   Tests that require mocking storage/env/db/auth live here, separate
   from image-variants.test.ts which tests the real sharp pipeline
   without any module mocks (jest.mock hoisting would conflict).

   Coverage:
   2. resolvePhotoUrls — legacy passthrough, CDN path, s3 presign
   3. GET /api/tastes/[id]/original — plan gating, variant + legacy key, 404
   4. POST /api/tastes — sharp-failure fallback to single-key upload
   ============================================================ */

// ── module mocks (hoisted by jest) ───────────────────────────────────────────

jest.mock('../storage', () => ({
  ...jest.requireActual('../storage'),
  getSignedPhotoUrl: jest.fn(),
  uploadPhoto: jest.fn(),
  deletePhoto: jest.fn(),
}));

jest.mock('../env', () => ({
  getPhotoStorage: jest.fn().mockReturnValue('s3'),
  getPhotoPublicBaseUrl: jest.fn().mockReturnValue(''),
  getPhotoCdnBaseUrl: jest.fn().mockReturnValue(''),
}));

jest.mock('../auth', () => ({
  getUserFromRequest: jest.fn(),
}));

jest.mock('../cors', () => ({
  withCors: (_res: Response) => _res,
  corsPreflight: () => new Response(null, { status: 204 }),
}));

// For upload-fallback only — must mock makeVariants so sharp failure is
// simulated without running the real transcode.
jest.mock('../image-variants', () => ({
  ...jest.requireActual('../image-variants'),
  makeVariants: jest.fn(),
}));

// db: mock getRawImage + createTaste; keep everything else real-shaped.
jest.mock('../db', () => ({
  ...jest.requireActual('../db'),
  getRawImage: jest.fn(),
  createTaste: jest.fn().mockResolvedValue({ id: 'new-taste' }),
  resolvePhotoUrls: jest.requireActual('../db').resolvePhotoUrls,
}));

// ── imports (after mocks) ─────────────────────────────────────────────────────

import { resolvePhotoUrls, getRawImage, createTaste } from '../db';
import { getSignedPhotoUrl, uploadPhoto, deletePhoto, PRESIGN_TTL_SECONDS } from '../storage';
import { getPhotoStorage, getPhotoCdnBaseUrl } from '../env';
import { getUserFromRequest } from '../auth';
import { makeVariants, isVariantKey } from '../image-variants';
import { GET } from '../../app/api/tastes/[id]/original/route';
import { POST } from '../../app/api/tastes/route';

const mockedGetSignedPhotoUrl = jest.mocked(getSignedPhotoUrl);
const mockedGetPhotoStorage = jest.mocked(getPhotoStorage);
const mockedGetPhotoCdnBaseUrl = jest.mocked(getPhotoCdnBaseUrl);
const mockedGetRawImage = jest.mocked(getRawImage);
const mockedGetUserFromRequest = jest.mocked(getUserFromRequest);
const mockedMakeVariants = jest.mocked(makeVariants);
const mockedUploadPhoto = jest.mocked(uploadPhoto);
const mockedDeletePhoto = jest.mocked(deletePhoto);
const mockedCreateTaste = jest.mocked(createTaste);

const UUID = '123e4567-e89b-12d3-a456-426614174000';

type User = { id: string; plan: string; [k: string]: unknown };
const freeUser = (): User => ({ id: 'user-free', plan: 'free', email: 'f@example.com' });
const proUser  = (): User => ({ id: 'user-pro',  plan: 'pro',  email: 'p@example.com' });

function makeReq(id = 'taste-1'): Request {
  return new Request(`http://localhost/api/tastes/${id}/original`);
}
function makeCtx(id = 'taste-1') {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedGetPhotoStorage.mockReturnValue('s3');
  mockedGetPhotoCdnBaseUrl.mockReturnValue('');
});

// ── 2. resolvePhotoUrls ───────────────────────────────────────────────────────

describe('resolvePhotoUrls', () => {
  it('legacy absolute URL — passes through unchanged in all three fields', async () => {
    const url = 'https://example.com/photo.jpg';
    const result = await resolvePhotoUrls(url);
    expect(result).toEqual({ image: url, imageThumb: url, imageDisplay: url });
    expect(mockedGetSignedPhotoUrl).not.toHaveBeenCalled();
  });

  it('legacy /uploads/ path — passes through unchanged', async () => {
    const path = '/uploads/local.jpg';
    const result = await resolvePhotoUrls(path);
    expect(result).toEqual({ image: path, imageThumb: path, imageDisplay: path });
  });

  it('variant key + CDN base — derives stable CDN URLs; orig key never emitted', async () => {
    /* Regression: old code would pass the orig key straight through or try to
       presign it. With CDN, all URLs must be CDN paths. */
    mockedGetPhotoCdnBaseUrl.mockReturnValue('https://cdn.example.com');
    const ok = `t/${UUID}/orig.jpg`;

    const result = await resolvePhotoUrls(ok);

    expect(result.imageThumb).toBe(`https://cdn.example.com/t/${UUID}/thumb.webp`);
    expect(result.imageDisplay).toBe(`https://cdn.example.com/t/${UUID}/display.webp`);
    // image must equal display (never the raw orig key).
    expect(result.image).toBe(result.imageDisplay);
    expect(result.image).not.toContain('orig.jpg');
    // No presigning when CDN handles delivery.
    expect(mockedGetSignedPhotoUrl).not.toHaveBeenCalled();
  });

  it('variant key + CDN unset + s3 — presigns thumb and display; image equals display', async () => {
    const ok = `t/${UUID}/orig.jpg`;
    const thumbSigned   = 'https://s3.example.com/thumb?sig=a';
    const displaySigned = 'https://s3.example.com/display?sig=b';

    mockedGetSignedPhotoUrl
      .mockResolvedValueOnce(thumbSigned)
      .mockResolvedValueOnce(displaySigned);

    const result = await resolvePhotoUrls(ok);

    expect(result.imageThumb).toBe(thumbSigned);
    expect(result.imageDisplay).toBe(displaySigned);
    expect(result.image).toBe(displaySigned);
    // Must presign thumb and display keys — never the orig key.
    expect(mockedGetSignedPhotoUrl).toHaveBeenCalledWith(`t/${UUID}/thumb.webp`);
    expect(mockedGetSignedPhotoUrl).toHaveBeenCalledWith(`t/${UUID}/display.webp`);
    expect(mockedGetSignedPhotoUrl).not.toHaveBeenCalledWith(ok);
  });

  it('null/undefined/empty — returns three empty strings', async () => {
    expect(await resolvePhotoUrls(null)).toEqual({ image: '', imageThumb: '', imageDisplay: '' });
    expect(await resolvePhotoUrls(undefined)).toEqual({ image: '', imageThumb: '', imageDisplay: '' });
    expect(await resolvePhotoUrls('')).toEqual({ image: '', imageThumb: '', imageDisplay: '' });
  });
});

// ── 3. GET /api/tastes/[id]/original ────────────────────────────────────────

describe('GET /api/tastes/[id]/original', () => {
  it('returns 403 pro_required for a free user', async () => {
    mockedGetUserFromRequest.mockResolvedValueOnce(freeUser() as never);
    mockedGetRawImage.mockResolvedValueOnce(`t/${UUID}/orig.jpg`);

    const res = await GET(makeReq() as never, makeCtx() as never);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('pro_required');
  });

  it('returns 200 { url, expiresIn } for a pro user with a variant key', async () => {
    /* Regression: before task #3 there was no /original endpoint at all. */
    const signed = 'https://s3.example.com/orig?sig=x';
    mockedGetUserFromRequest.mockResolvedValueOnce(proUser() as never);
    mockedGetRawImage.mockResolvedValueOnce(`t/${UUID}/orig.jpg`);
    mockedGetSignedPhotoUrl.mockResolvedValueOnce(signed);

    const res = await GET(makeReq() as never, makeCtx() as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.url).toBe(signed);
    expect(body.expiresIn).toBe(PRESIGN_TTL_SECONDS);
    // Must presign the orig key itself, not its thumb/display siblings.
    expect(mockedGetSignedPhotoUrl).toHaveBeenCalledWith(
      `t/${UUID}/orig.jpg`,
      PRESIGN_TTL_SECONDS,
    );
  });

  it('pro user with legacy flat key — presigns that key (history unlock)', async () => {
    /* Users who uploaded before variant generation have a flat UUID.ext key.
       The endpoint must presign it so their history unlocks at Pro. */
    const legacyKey = `${UUID}.jpg`;
    const signed = 'https://s3.example.com/legacy?sig=y';
    mockedGetUserFromRequest.mockResolvedValueOnce(proUser() as never);
    mockedGetRawImage.mockResolvedValueOnce(legacyKey);
    mockedGetSignedPhotoUrl.mockResolvedValueOnce(signed);

    const res = await GET(makeReq() as never, makeCtx() as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.url).toBe(signed);
    expect(mockedGetSignedPhotoUrl).toHaveBeenCalledWith(legacyKey, PRESIGN_TTL_SECONDS);
  });

  it('returns 404 when the taste is not found or not owned by the user', async () => {
    mockedGetUserFromRequest.mockResolvedValueOnce(proUser() as never);
    mockedGetRawImage.mockResolvedValueOnce(null);

    const res = await GET(makeReq() as never, makeCtx() as never);
    expect(res.status).toBe(404);
  });
});

// ── 4. POST /api/tastes — sharp-failure fallback ─────────────────────────────

describe('POST /api/tastes — sharp failure fallback', () => {
  beforeEach(() => {
    mockedGetUserFromRequest.mockResolvedValue(proUser() as never);
    mockedGetSignedPhotoUrl.mockResolvedValue('https://s3.example.com/photo?sig=z');
    mockedUploadPhoto.mockResolvedValue('fallback-uuid.jpg');
  });

  it('falls back to single-key legacy upload when makeVariants throws', async () => {
    /* Regression: if sharp fails the entire upload must NOT fail. The route
       catches the error, uploads the raw buffer once under a flat UUID key,
       and stores that flat key (not a variant orig key) in the DB. */
    mockedMakeVariants.mockRejectedValueOnce(new Error('sharp: unsupported format'));

    const photoFile = new File([Buffer.from('fake-image-data')], 'test.heic', {
      type: 'image/heic',
    });
    const form = new FormData();
    form.append('name', 'Heic snack');
    form.append('place', 'Nowhere');
    form.append('price', '$1');
    form.append('verdict', 'yum');
    form.append('notes', '');
    form.append('photo', photoFile);

    const req = new Request('http://localhost/api/tastes', { method: 'POST', body: form });
    const res = await POST(req as never);

    // Upload must still succeed.
    expect(res.status).toBe(201);
    // makeVariants was attempted.
    expect(mockedMakeVariants).toHaveBeenCalled();
    // Exactly ONE uploadPhoto call — the fallback single-key path.
    expect(mockedUploadPhoto).toHaveBeenCalledTimes(1);
    // The stored key must be a flat UUID key, not a variant orig key.
    const [, opts] = mockedUploadPhoto.mock.calls[0];
    expect(isVariantKey(opts.key)).toBe(false);
  });

  it('does not delete the orig until its (slow) upload settles — pins the race', async () => {
    /* Regression for the orphan RACE specifically. thumb rejects immediately
       while the orig upload is still in flight. Under the old Promise.all the
       catch would fire on thumb's rejection and delete the orig key BEFORE the
       orig PUT completes — the late PUT then re-creates the orphan. allSettled
       waits for the orig upload to finish first, so delete(orig) is ordered
       AFTER orig-upload-done. This test fails against Promise.all and passes
       against allSettled. */
    const order: string[] = [];
    mockedMakeVariants.mockResolvedValueOnce({ thumb: Buffer.from('t'), display: Buffer.from('d') });

    let origKeyUsed = '';
    mockedUploadPhoto.mockImplementation((_buf, opts) => {
      const key = opts.key;
      if (/\/orig\./.test(key)) {
        origKeyUsed = key;
        // Slow orig upload that resolves only after a tick.
        return new Promise((resolve) =>
          setTimeout(() => { order.push('orig-upload-done'); resolve(key); }, 10),
        );
      }
      if (key.endsWith('thumb.webp')) return Promise.reject(new Error('thumb failed'));
      if (key.endsWith('display.webp')) return Promise.resolve(key);
      return Promise.resolve(key); // flat fallback
    });
    mockedDeletePhoto.mockImplementation((key: string) => {
      order.push(`delete:${key}`);
      return Promise.resolve();
    });

    const form = new FormData();
    form.append('name', 'X');
    form.append('verdict', 'yum');
    form.append('photo', new File([Buffer.from('d')], 'a.jpg', { type: 'image/jpeg' }));

    const req = new Request('http://localhost/api/tastes', { method: 'POST', body: form });
    const res = await POST(req as never);

    expect(res.status).toBe(201);
    // The orig upload must have completed BEFORE its cleanup delete ran.
    expect(order).toContain('orig-upload-done');
    expect(order).toContain(`delete:${origKeyUsed}`);
    expect(order.indexOf('orig-upload-done')).toBeLessThan(order.indexOf(`delete:${origKeyUsed}`));
  });

  it('best-effort deletes the three variant siblings before the fallback upload', async () => {
    /* Regression: Promise.all uploads orig+thumb+display together. If one fails
       mid-flight the catch must clean up the siblings that DID upload, or they
       orphan in the bucket. The catch deletes all three keys before re-uploading. */
    mockedMakeVariants.mockRejectedValueOnce(new Error('boom'));

    const form = new FormData();
    form.append('name', 'X');
    form.append('verdict', 'yum');
    form.append('photo', new File([Buffer.from('d')], 'a.jpg', { type: 'image/jpeg' }));

    const req = new Request('http://localhost/api/tastes', { method: 'POST', body: form });
    await POST(req as never);

    // orig + thumb + display cleanup attempted.
    expect(mockedDeletePhoto).toHaveBeenCalledTimes(3);
    const deleted = mockedDeletePhoto.mock.calls.map((c) => c[0]);
    expect(deleted.some((k) => /\/orig\./.test(k))).toBe(true);
    expect(deleted.some((k) => k.endsWith('thumb.webp'))).toBe(true);
    expect(deleted.some((k) => k.endsWith('display.webp'))).toBe(true);
  });
});

// ── 5. POST /api/tastes — client cannot inject a bare storage key (IDOR) ──────

describe('POST /api/tastes — client image key is not trusted', () => {
  beforeEach(() => {
    mockedGetUserFromRequest.mockResolvedValue(proUser() as never);
    mockedCreateTaste.mockResolvedValue({ id: 'new-taste' } as never);
  });

  it('strips a client-supplied bare storage key from a JSON create', async () => {
    /* Regression: createTaste used input.image verbatim, so a caller could store
       another user's object key (e.g. t/<victim>/orig.jpg) and later mint a
       presigned original via /original. The route must drop bare keys. */
    const req = new Request('http://localhost/api/tastes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Evil',
        verdict: 'yum',
        image: `t/${UUID}/orig.jpg`,
      }),
    });
    const res = await POST(req as never);
    expect(res.status).toBe(201);

    const [, input] = mockedCreateTaste.mock.calls[0];
    expect(input.image).toBe('');
  });

  it('keeps a legacy absolute URL on a JSON create (seed/import path)', async () => {
    const url = 'https://images.unsplash.com/photo.jpg';
    const req = new Request('http://localhost/api/tastes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Seed', verdict: 'yum', image: url }),
    });
    await POST(req as never);
    const [, input] = mockedCreateTaste.mock.calls[0];
    expect(input.image).toBe(url);
  });
});

// ── 6. GET /api/tastes/[id]/original — legacy absolute values ─────────────────

describe('GET /api/tastes/[id]/original — legacy values', () => {
  it('returns a legacy absolute URL as-is without presigning (blob/seed rows)', async () => {
    /* A blob-backend or seed row stores a full URL, not a key. Presigning it
       would 500. The endpoint must return it directly. */
    const url = 'https://blob.example.com/photo.jpg';
    mockedGetUserFromRequest.mockResolvedValueOnce(proUser() as never);
    mockedGetRawImage.mockResolvedValueOnce(url);

    const res = await GET(makeReq() as never, makeCtx() as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.url).toBe(url);
    expect(mockedGetSignedPhotoUrl).not.toHaveBeenCalled();
  });
});
