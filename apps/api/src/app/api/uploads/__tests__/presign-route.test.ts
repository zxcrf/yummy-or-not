import { NextRequest } from 'next/server';

jest.mock('@/lib/storage', () => ({
  getPresignedUploadUrl: jest.fn(),
}));

jest.mock('@/lib/env', () => ({
  getPhotoStorage: jest.fn(),
}));

jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn(),
}));

jest.mock('@/lib/cors', () => ({
  withCors: (res: Response) => res,
  corsPreflight: () => new Response(null, { status: 204 }),
}));

import { POST } from '../presign/route';
import { getPresignedUploadUrl } from '@/lib/storage';
import { getPhotoStorage } from '@/lib/env';
import { getUserFromRequest } from '@/lib/auth';

const mockedPresign = jest.mocked(getPresignedUploadUrl);
const mockedStorage = jest.mocked(getPhotoStorage);
const mockedAuth = jest.mocked(getUserFromRequest);

const user = {
  id: 'u1',
  displayName: 'Alice',
  phone: '',
  email: 'a@example.com',
  avatar: '',
  locale: 'zh',
  plan: 'free' as const,
  warningsEnabled: true,
  locationEnabled: false,
  mediaEnabled: false,
  defaultVisibility: 'private' as const,
  createdAt: '2026-01-01T00:00:00.000Z',
};

function reqOf(body: unknown) {
  return new NextRequest('http://localhost/api/uploads/presign', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedAuth.mockResolvedValue(user);
  mockedStorage.mockReturnValue('s3');
  mockedPresign.mockResolvedValue('https://r2.example/u/u1/avatar/abc.jpg?X-Amz-Signature=sig');
});

describe('POST /api/uploads/presign', () => {
  it('401 when unauthenticated', async () => {
    mockedAuth.mockResolvedValue(null);
    const res = await POST(reqOf({ kind: 'avatar', contentType: 'image/jpeg' }));
    expect(res.status).toBe(401);
    expect(mockedPresign).not.toHaveBeenCalled();
  });

  it('501 presign_unsupported when backend is not s3', async () => {
    mockedStorage.mockReturnValue('local');
    const res = await POST(reqOf({ kind: 'avatar', contentType: 'image/jpeg' }));
    const body = await res.json();
    expect(res.status).toBe(501);
    expect(body.error).toBe('presign_unsupported');
    expect(mockedPresign).not.toHaveBeenCalled();
  });

  it('400 invalid_kind when kind is neither avatar nor video', async () => {
    const res = await POST(reqOf({ kind: 'document', contentType: 'image/jpeg' }));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toBe('invalid_kind');
    expect(mockedPresign).not.toHaveBeenCalled();
  });

  it('400 unsupported_content_type for a non-allowlisted type', async () => {
    const res = await POST(reqOf({ kind: 'avatar', contentType: 'video/mp4' }));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toBe('unsupported_content_type');
    expect(mockedPresign).not.toHaveBeenCalled();
  });

  it('400 unsupported_content_type for "toString" (prototype-chain bypass)', async () => {
    const res = await POST(reqOf({ kind: 'avatar', contentType: 'toString' }));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toBe('unsupported_content_type');
    expect(mockedPresign).not.toHaveBeenCalled();
  });

  it('400 unsupported_content_type for "constructor" (prototype-chain bypass)', async () => {
    const res = await POST(reqOf({ kind: 'avatar', contentType: 'constructor' }));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toBe('unsupported_content_type');
    expect(mockedPresign).not.toHaveBeenCalled();
  });

  it('200 returns uploadUrl + server key under u/{uid}/avatar/ and echoes Content-Type header', async () => {
    const res = await POST(reqOf({ kind: 'avatar', contentType: 'image/png' }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.uploadUrl).toContain('X-Amz-Signature');
    expect(body.key).toMatch(/^u\/u1\/avatar\/[0-9a-f-]+\.png$/);
    expect(body.headers).toEqual({ 'Content-Type': 'image/png' });
    // the presign helper was called with the SERVER key + content type
    expect(mockedPresign).toHaveBeenCalledWith(body.key, 'image/png');
  });

  it('ignores any client-supplied key (server generates it)', async () => {
    const res = await POST(
      reqOf({ kind: 'avatar', contentType: 'image/jpeg', key: 'u/victim/avatar/evil.jpg' })
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    // server key is under THIS user's namespace, never the injected one
    expect(body.key).toMatch(/^u\/u1\/avatar\/[0-9a-f-]+\.jpg$/);
    expect(body.key).not.toContain('victim');
  });
});

describe('POST /api/uploads/presign — kind:video (S3b Phase 2)', () => {
  it('⟦GATE⟧ 403 media_not_enabled when the account lacks the media capability', async () => {
    // user.mediaEnabled is false by default — the Pro gate at the presign boundary.
    const res = await POST(reqOf({ kind: 'video', contentType: 'video/mp4' }));
    const body = await res.json();
    expect(res.status).toBe(403);
    expect(body.error).toBe('media_not_enabled');
    expect(mockedPresign).not.toHaveBeenCalled();
  });

  it('400 unsupported_content_type for a non-video type even when media is enabled', async () => {
    mockedAuth.mockResolvedValue({ ...user, mediaEnabled: true });
    const res = await POST(reqOf({ kind: 'video', contentType: 'image/jpeg' }));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toBe('unsupported_content_type');
    expect(mockedPresign).not.toHaveBeenCalled();
  });

  it('400 unsupported_content_type for "constructor" (prototype-chain bypass)', async () => {
    mockedAuth.mockResolvedValue({ ...user, mediaEnabled: true });
    const res = await POST(reqOf({ kind: 'video', contentType: 'constructor' }));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toBe('unsupported_content_type');
    expect(mockedPresign).not.toHaveBeenCalled();
  });

  it('200 mints a clip key under u/{uid}/clips/{uuid}/clip.mp4 for video/mp4', async () => {
    mockedAuth.mockResolvedValue({ ...user, mediaEnabled: true });
    const res = await POST(reqOf({ kind: 'video', contentType: 'video/mp4' }));
    const body = await res.json();
    expect(res.status).toBe(200);
    // ⟦DR#1⟧ user-owned clips prefix + shape — never a shared t/ key.
    expect(body.key).toMatch(/^u\/u1\/clips\/[0-9a-f-]+\/clip\.mp4$/);
    expect(body.headers).toEqual({ 'Content-Type': 'video/mp4' });
    expect(mockedPresign).toHaveBeenCalledWith(body.key, 'video/mp4');
  });

  it('200 maps video/quicktime → .mov', async () => {
    mockedAuth.mockResolvedValue({ ...user, mediaEnabled: true });
    const res = await POST(reqOf({ kind: 'video', contentType: 'video/quicktime' }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.key).toMatch(/^u\/u1\/clips\/[0-9a-f-]+\/clip\.mov$/);
  });

  it('⟦DR#1⟧ the clip key is under THIS user, never a client-injected namespace', async () => {
    mockedAuth.mockResolvedValue({ ...user, mediaEnabled: true });
    const res = await POST(
      reqOf({ kind: 'video', contentType: 'video/mp4', key: 'u/victim/clips/x/clip.mp4' })
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.key).toMatch(/^u\/u1\/clips\//);
    expect(body.key).not.toContain('victim');
  });
});
