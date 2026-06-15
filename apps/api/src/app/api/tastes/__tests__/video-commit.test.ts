// S3b Phase 2 — POST /api/tastes video commit gate.
//
// Pins the server-side contract for attaching a clip (the poster rides the
// existing `photo` → image pipeline; the clip is a separately-uploaded private
// object referenced by clipKey):
//   ⟦GATE⟧  media_enabled re-asserted at COMMIT (not just presign) → 403.
//   ⟦DR#1⟧  clipKey must be under u/{user.id}/clips/.../clip.{mp4|mov}; a foreign
//           prefix (another user's key) is 400 invalid_clip_key (IDOR guard).
//   ⟦DR#5⟧  HEAD-verify (NOT a 20MB buffer): missing→400, wrong type→400,
//           oversize→413, each best-effort deletes the rejected object.
//   ⟦DR#2⟧  durationMs>15s → 400 clip_too_long; clip fields on a non-video → 400.
//
// Uses the JSON path (no multipart) for the clip fields — the gate is identical
// on both paths (resolveVideoCommit) and JSON keeps the test free of FormData
// file plumbing. The poster pipeline is exercised elsewhere; here we assert the
// CLIP gate only, so no `photo` file is needed.

jest.mock('@/lib/db', () => ({
  createTaste: jest.fn(),
  listTastes: jest.fn(),
  countTastes: jest.fn(),
  // CreateTasteError must be the same class the route catches.
  CreateTasteError: class CreateTasteError extends Error {
    code: string;
    constructor(code: string) {
      super(code);
      this.code = code;
      this.name = 'CreateTasteError';
    }
  },
}));

jest.mock('@/lib/storage', () => ({
  uploadPhoto: jest.fn(),
  deletePhoto: jest.fn().mockResolvedValue(undefined),
  // Real gate logic: a video upload needs media_enabled. (Not exercised on the
  // JSON clip path, but the route imports it.)
  assertMediaAllowed: jest.fn().mockReturnValue(null),
  headObject: jest.fn(),
  CLIP_MAX_BYTES: 20 * 1024 * 1024,
}));

jest.mock('@/lib/env', () => ({
  getPhotoStorage: jest.fn().mockReturnValue('s3'),
}));

jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn(),
}));

jest.mock('@/lib/cors', () => ({
  withCors: (res: Response) => res,
  corsPreflight: () => new Response(null, { status: 204 }),
}));

import { POST } from '../route';
import { createTaste, countTastes } from '@/lib/db';
import { headObject, deletePhoto } from '@/lib/storage';
import { getUserFromRequest } from '@/lib/auth';

const mockedCreate = jest.mocked(createTaste);
const mockedCount = jest.mocked(countTastes);
const mockedHead = jest.mocked(headObject);
const mockedDelete = jest.mocked(deletePhoto);
const mockedAuth = jest.mocked(getUserFromRequest);

const proUser = {
  id: 'u1',
  displayName: 'Alice',
  phone: '',
  email: 'a@example.com',
  avatar: '',
  locale: 'zh',
  plan: 'pro' as const,
  warningsEnabled: true,
  locationEnabled: false,
  mediaEnabled: true,
  defaultVisibility: 'private' as const,
  createdAt: '2026-01-01T00:00:00.000Z',
};

const GOOD_KEY = 'u/u1/clips/11111111-1111-1111-1111-111111111111/clip.mp4';

function jsonReq(body: unknown) {
  return new Request('http://localhost/api/tastes', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;
}

const videoBody = (over: Record<string, unknown> = {}) => ({
  name: 'Ramen',
  verdict: 'yum',
  mediaType: 'video',
  clipKey: GOOD_KEY,
  durationMs: 8000,
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockedAuth.mockResolvedValue(proUser);
  mockedCount.mockResolvedValue(0);
  // A default valid HEAD (real video, in-size). Overridden per-test.
  mockedHead.mockResolvedValue({ contentType: 'video/mp4', contentLength: 1_000_000 });
  // createTaste echoes the media fields so the happy path can assert persistence.
  mockedCreate.mockImplementation(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (_uid: string, input: any) =>
      ({ id: 't1', name: input.name, mediaType: input.mediaType, durationMs: input.durationMs ?? null }) as never
  );
});

describe('POST /api/tastes — video commit gate', () => {
  it('⟦GATE⟧ 403 media_not_enabled when the account lacks media (commit-side re-assert)', async () => {
    mockedAuth.mockResolvedValue({ ...proUser, mediaEnabled: false });
    const res = await POST(jsonReq(videoBody()));
    const body = await res.json();
    expect(res.status).toBe(403);
    expect(body.error).toBe('media_not_enabled');
    expect(mockedCreate).not.toHaveBeenCalled();
    expect(mockedHead).not.toHaveBeenCalled();
  });

  it('⟦DR#1⟧ 400 invalid_clip_key for a foreign-prefix key (another user) — no HEAD probe', async () => {
    const res = await POST(
      jsonReq(videoBody({ clipKey: 'u/victim/clips/abc/clip.mp4' }))
    );
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toBe('invalid_clip_key');
    expect(mockedHead).not.toHaveBeenCalled();
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it('400 invalid_clip_key for a wrong-shape key (not .../clip.{mp4|mov})', async () => {
    const res = await POST(
      jsonReq(videoBody({ clipKey: 'u/u1/clips/abc/notclip.mp4' }))
    );
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toBe('invalid_clip_key');
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it('⟦DR#2⟧ 400 clip_too_long when durationMs exceeds the 15s cap (+tolerance)', async () => {
    const res = await POST(jsonReq(videoBody({ durationMs: 20_000 })));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toBe('clip_too_long');
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it('⟦DR#5⟧ 400 clip_not_uploaded when the object is missing (HEAD null)', async () => {
    mockedHead.mockResolvedValue(null);
    const res = await POST(jsonReq(videoBody()));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toBe('clip_not_uploaded');
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it('⟦DR#5⟧ 400 unsupported_content_type when HEAD type is not video/* + deletes the object', async () => {
    mockedHead.mockResolvedValue({ contentType: 'application/octet-stream', contentLength: 100 });
    const res = await POST(jsonReq(videoBody()));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toBe('unsupported_content_type');
    expect(mockedDelete).toHaveBeenCalledWith(GOOD_KEY);
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it('⟦DR#5⟧ 413 clip_too_large when HEAD size exceeds CLIP_MAX_BYTES + deletes the object', async () => {
    mockedHead.mockResolvedValue({ contentType: 'video/mp4', contentLength: 21 * 1024 * 1024 });
    const res = await POST(jsonReq(videoBody()));
    const body = await res.json();
    expect(res.status).toBe(413);
    expect(body.error).toBe('clip_too_large');
    expect(mockedDelete).toHaveBeenCalledWith(GOOD_KEY);
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it('⟦DR#2⟧ 400 invalid_media when a non-video create carries clip fields', async () => {
    const res = await POST(
      jsonReq({ name: 'Snack', verdict: 'yum', clipKey: GOOD_KEY })
    );
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toBe('invalid_media');
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it('201 persists media_type/clip_key/duration_ms on a valid video commit', async () => {
    const res = await POST(jsonReq(videoBody({ durationMs: 8000 })));
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(mockedHead).toHaveBeenCalledWith(GOOD_KEY);
    // createTaste received the validated media fields.
    expect(mockedCreate).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({ mediaType: 'video', clipKey: GOOD_KEY, durationMs: 8000 })
    );
    expect(body.mediaType).toBe('video');
    // A valid clip is NOT deleted.
    expect(mockedDelete).not.toHaveBeenCalled();
  });
});
