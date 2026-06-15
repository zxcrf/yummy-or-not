// S3b Phase 2 ⟦DR#4⟧ — DELETE /api/tastes/[id] must also clean up the private
// clip object, not just the image variants. Pins that the raw clip_key is fetched
// before the row is deleted and best-effort deletePhoto'd; an image row (no clip)
// triggers no clip delete.

jest.mock('@/lib/db', () => ({
  getTaste: jest.fn(),
  updateTaste: jest.fn(),
  deleteTaste: jest.fn(),
  getRawImage: jest.fn(),
  getRawClipKey: jest.fn(),
}));

jest.mock('@/lib/storage', () => ({
  deletePhoto: jest.fn().mockResolvedValue(undefined),
}));

// Real variant helpers so an isVariantKey poster expands to 3 sibling deletes.
jest.mock('@/lib/cors', () => ({
  withCors: (res: Response) => res,
  corsPreflight: () => new Response(null, { status: 204 }),
}));

jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn(),
}));

import { DELETE } from '../[id]/route';
import { deleteTaste, getRawImage, getRawClipKey } from '@/lib/db';
import { deletePhoto } from '@/lib/storage';
import { getUserFromRequest } from '@/lib/auth';

const mockedDeleteTaste = jest.mocked(deleteTaste);
const mockedRawImage = jest.mocked(getRawImage);
const mockedRawClip = jest.mocked(getRawClipKey);
const mockedDeletePhoto = jest.mocked(deletePhoto);
const mockedAuth = jest.mocked(getUserFromRequest);

const user = {
  id: 'u1', displayName: 'A', phone: '', email: 'a@x.com', avatar: '', locale: 'zh',
  plan: 'pro' as const, warningsEnabled: true, locationEnabled: false, mediaEnabled: true,
  defaultVisibility: 'private' as const, createdAt: '2026-01-01T00:00:00.000Z',
};

function delReq() {
  return new Request('http://localhost/api/tastes/t1', { method: 'DELETE' }) as never;
}
const ctx = { params: Promise.resolve({ id: 't1' }) };

const CLIP_KEY = 'u/u1/clips/aaaa/clip.mp4';
const VARIANT_POSTER = 't/00000000-0000-0000-0000-000000000001/orig.jpg';

beforeEach(() => {
  jest.clearAllMocks();
  mockedAuth.mockResolvedValue(user);
  mockedDeleteTaste.mockResolvedValue(true);
});

describe('DELETE /api/tastes/[id] — clip cleanup', () => {
  it('⟦DR#4⟧ deletes the clip object for a video row (poster variants + clip)', async () => {
    mockedRawImage.mockResolvedValue(VARIANT_POSTER);
    mockedRawClip.mockResolvedValue(CLIP_KEY);

    const res = await DELETE(delReq(), ctx);
    expect(res.status).toBe(200);

    // The clip key was deleted…
    expect(mockedDeletePhoto).toHaveBeenCalledWith(CLIP_KEY);
    // …alongside the three poster variant siblings.
    const v = '00000000-0000-0000-0000-000000000001';
    expect(mockedDeletePhoto).toHaveBeenCalledWith(`t/${v}/orig.jpg`);
    expect(mockedDeletePhoto).toHaveBeenCalledWith(`t/${v}/thumb.webp`);
    expect(mockedDeletePhoto).toHaveBeenCalledWith(`t/${v}/display.webp`);
  });

  it('an image row (no clip_key) triggers no clip delete', async () => {
    mockedRawImage.mockResolvedValue(VARIANT_POSTER);
    mockedRawClip.mockResolvedValue(null);

    const res = await DELETE(delReq(), ctx);
    expect(res.status).toBe(200);
    expect(mockedDeletePhoto).not.toHaveBeenCalledWith(CLIP_KEY);
  });

  it('404 when the row is not owned — no key fetch leaks across delete', async () => {
    mockedRawImage.mockResolvedValue(null);
    mockedRawClip.mockResolvedValue(null);
    mockedDeleteTaste.mockResolvedValue(false);

    const res = await DELETE(delReq(), ctx);
    expect(res.status).toBe(404);
    expect(mockedDeletePhoto).not.toHaveBeenCalled();
  });
});
