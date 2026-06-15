// S3b Phase 2 ⟦DR#3⟧ — clips are PRIVATE-ONLY. The public share preview must
// NEVER carry clipUrl, even when the shared source taste is a video. The preview
// hand-builds a poster-only DTO; this pins that it stays poster-only (no clipUrl
// key, regardless of getTaste returning a video Taste with a resolved clipUrl).

jest.mock('@/lib/db', () => ({
  getShareToken: jest.fn(),
  getTaste: jest.fn(),
  getRawImage: jest.fn(),
}));

jest.mock('@/lib/storage', () => ({
  // Short-lived preview presign of the POSTER original.
  getSignedPhotoUrl: jest.fn(async (key: string) => `https://r2.example/${key}?sig=preview`),
}));

jest.mock('@/lib/cors', () => ({
  withCors: (res: Response) => res,
  corsPreflight: () => new Response(null, { status: 204 }),
}));

import { GET } from '../[token]/route';
import { getShareToken, getTaste, getRawImage } from '@/lib/db';

const mockedGetToken = jest.mocked(getShareToken);
const mockedGetTaste = jest.mocked(getTaste);
const mockedGetRawImage = jest.mocked(getRawImage);

function req() {
  return new Request('http://localhost/api/share/tok123') as never;
}
const ctx = { params: Promise.resolve({ token: 'tok123' }) };

beforeEach(() => {
  jest.clearAllMocks();
  mockedGetToken.mockResolvedValue({
    token: 'tok123',
    tasteId: 't1',
    ownerId: 'owner1',
    revoked: false,
    expiresAt: null,
  });
  mockedGetRawImage.mockResolvedValue('t/00000000-0000-0000-0000-000000000001/orig.jpg');
});

describe('GET /api/share/[token] — video source stays poster-only', () => {
  it('⟦DR#3⟧ the preview payload has NO clipUrl even for a video taste', async () => {
    // The owner serializer (getTaste) resolves a clipUrl, but the share DTO is
    // hand-built and must not forward it.
    mockedGetTaste.mockResolvedValue({
      id: 't1',
      name: 'Ramen',
      place: 'Shop',
      price: '12.00',
      status: 'tasted',
      verdict: 'yum',
      tags: ['Ramen'],
      boughtCount: 1,
      warnBeforeBuy: false,
      purchases: [],
      date: 'just now',
      notes: '',
      visibility: 'shared',
      mediaType: 'video',
      clipUrl: 'https://r2.example/u/owner1/clips/x/clip.mp4?sig=SECRET',
      durationMs: 8000,
      image: 'https://r2.example/poster?sig=x',
      imageThumb: 'https://r2.example/poster-thumb?sig=x',
      imageDisplay: 'https://r2.example/poster-display?sig=x',
      imageKey: 't/00000000-0000-0000-0000-000000000001/orig.jpg',
      createdAt: '2026-01-01T00:00:00.000Z',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const res = await GET(req(), ctx);
    const body = await res.json();

    expect(res.status).toBe(200);
    // Poster preview is present (a short-lived presign of the original).
    expect(body.photoUrl).toContain('sig=preview');
    // The private clip URL must NOT leak into the public preview.
    expect(body).not.toHaveProperty('clipUrl');
    expect(JSON.stringify(body)).not.toContain('SECRET');
    expect(JSON.stringify(body)).not.toContain('clip.mp4');
  });
});
