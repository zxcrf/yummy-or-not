import { NextRequest } from 'next/server';

jest.mock('@/lib/db', () => ({
  updateUserSettings: jest.fn(),
  getRawAvatar: jest.fn(),
  // Real legacy-prefix logic so the route's passthrough branch behaves correctly.
  isLegacyPhotoValue: (image: string) =>
    image.startsWith('http://') || image.startsWith('https://') || image.startsWith('/uploads/'),
}));

jest.mock('@/lib/storage', () => {
  // OversizeError must be defined INSIDE the factory so jest.mock hoisting
  // doesn't create a TDZ reference. The route imports OversizeError from
  // '@/lib/storage', so the mock must export the same class that the route
  // uses in its `instanceof` check — this factory provides that shared class.
  class OversizeError extends Error {
    bytesSeen: number;
    constructor(bytesSeen: number) {
      super(`Object exceeds size limit (${bytesSeen} bytes seen)`);
      this.name = 'OversizeError';
      this.bytesSeen = bytesSeen;
    }
  }
  return {
    getObjectBuffer: jest.fn(),
    deletePhoto: jest.fn().mockResolvedValue(undefined),
    AVATAR_MAX_BYTES: 8 * 1024 * 1024,
    OversizeError,
  };
});

jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn(),
}));

jest.mock('@/lib/cors', () => ({
  withCors: (res: Response) => res,
  corsPreflight: () => new Response(null, { status: 204 }),
}));

const sharpMeta = jest.fn();
jest.mock('sharp', () => jest.fn(() => ({ metadata: sharpMeta })));

import { PATCH } from '../route';
import { updateUserSettings, getRawAvatar } from '@/lib/db';
import { getObjectBuffer, deletePhoto, OversizeError } from '@/lib/storage';
import { getUserFromRequest } from '@/lib/auth';

const mockedUpdate = jest.mocked(updateUserSettings);
const mockedGetRawAvatar = jest.mocked(getRawAvatar);
const mockedGetObjectBuffer = jest.mocked(getObjectBuffer);
const mockedDeletePhoto = jest.mocked(deletePhoto);
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

function reqOf(body: object) {
  return new NextRequest('http://localhost/api/user', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedAuth.mockResolvedValue(user);
  mockedGetRawAvatar.mockResolvedValue('');
  mockedUpdate.mockImplementation(async (_id, input) => ({ ...user, ...input }));
  sharpMeta.mockResolvedValue({ format: 'jpeg' });
});

const OWN_KEY = 'u/u1/avatar/new-uuid.jpg';

describe('PATCH /api/user avatar commit', () => {
  it('400 invalid_avatar for non-string avatar', async () => {
    const res = await PATCH(reqOf({ avatar: 42 }));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toBe('invalid_avatar');
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it('400 invalid_avatar for a foreign-prefixed key (no byte probe)', async () => {
    const res = await PATCH(reqOf({ avatar: 'u/victim/avatar/evil.jpg' }));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toBe('invalid_avatar');
    expect(mockedGetObjectBuffer).not.toHaveBeenCalled();
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it('400 avatar_not_uploaded when the object is missing', async () => {
    mockedGetObjectBuffer.mockResolvedValue(null);
    const res = await PATCH(reqOf({ avatar: OWN_KEY }));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toBe('avatar_not_uploaded');
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it('413 avatar_too_large when getObjectBuffer throws OversizeError (stream aborted, no full allocation)', async () => {
    // getObjectBuffer now throws OversizeError instead of returning an oversized
    // Buffer — the stream is aborted before the full object is buffered (DoS guard).
    mockedGetObjectBuffer.mockRejectedValue(new OversizeError(8 * 1024 * 1024 + 1));
    const res = await PATCH(reqOf({ avatar: OWN_KEY }));
    const body = await res.json();
    expect(res.status).toBe(413);
    expect(body.error).toBe('avatar_too_large');
    // ⟦DR#2⟧ rejected object must still be deleted
    expect(mockedDeletePhoto).toHaveBeenCalledWith(OWN_KEY);
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it('400 unsupported_content_type when sharp cannot decode (spoofed bytes) and deletes', async () => {
    mockedGetObjectBuffer.mockResolvedValue(Buffer.from('not an image'));
    sharpMeta.mockRejectedValue(new Error('Input buffer contains unsupported image format'));
    const res = await PATCH(reqOf({ avatar: OWN_KEY }));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toBe('unsupported_content_type');
    expect(mockedDeletePhoto).toHaveBeenCalledWith(OWN_KEY);
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it('400 unsupported_content_type when decoded format is not in the allowlist and deletes', async () => {
    mockedGetObjectBuffer.mockResolvedValue(Buffer.from('gif bytes'));
    sharpMeta.mockResolvedValue({ format: 'gif' });
    const res = await PATCH(reqOf({ avatar: OWN_KEY }));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toBe('unsupported_content_type');
    expect(mockedDeletePhoto).toHaveBeenCalledWith(OWN_KEY);
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it('200 persists a valid byte-verified bare key', async () => {
    mockedGetObjectBuffer.mockResolvedValue(Buffer.from('jpeg bytes'));
    sharpMeta.mockResolvedValue({ format: 'jpeg' });
    const res = await PATCH(reqOf({ avatar: OWN_KEY }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(mockedUpdate).toHaveBeenCalledWith('u1', { avatar: OWN_KEY });
    expect(body.user.avatar).toBe(OWN_KEY);
  });

  it('deletes the prior bare-key avatar after a successful replace', async () => {
    mockedGetRawAvatar.mockResolvedValue('u/u1/avatar/old.jpg');
    mockedGetObjectBuffer.mockResolvedValue(Buffer.from('jpeg bytes'));
    const res = await PATCH(reqOf({ avatar: OWN_KEY }));
    expect(res.status).toBe(200);
    expect(mockedDeletePhoto).toHaveBeenCalledWith('u/u1/avatar/old.jpg');
  });

  it('does NOT delete a prior LEGACY avatar on replace', async () => {
    mockedGetRawAvatar.mockResolvedValue('https://oauth.example/avatar.png');
    mockedGetObjectBuffer.mockResolvedValue(Buffer.from('jpeg bytes'));
    const res = await PATCH(reqOf({ avatar: OWN_KEY }));
    expect(res.status).toBe(200);
    expect(mockedDeletePhoto).not.toHaveBeenCalled();
  });

  it('legacy https avatar passes through with NO byte probe', async () => {
    const res = await PATCH(reqOf({ avatar: 'https://oauth.example/avatar.png' }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(mockedGetObjectBuffer).not.toHaveBeenCalled();
    expect(mockedUpdate).toHaveBeenCalledWith('u1', { avatar: 'https://oauth.example/avatar.png' });
    expect(body.user.avatar).toBe('https://oauth.example/avatar.png');
  });

  it('empty-string avatar clears it (persists "")', async () => {
    const res = await PATCH(reqOf({ avatar: '' }));
    expect(res.status).toBe(200);
    expect(mockedGetObjectBuffer).not.toHaveBeenCalled();
    expect(mockedUpdate).toHaveBeenCalledWith('u1', { avatar: '' });
  });

  it('avatar-only PATCH is NOT rejected as empty (no-op guard fix)', async () => {
    mockedGetObjectBuffer.mockResolvedValue(Buffer.from('jpeg bytes'));
    const res = await PATCH(reqOf({ avatar: OWN_KEY }));
    expect(res.status).toBe(200);
  });

  it('truly empty PATCH still 400s', async () => {
    const res = await PATCH(reqOf({}));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(mockedUpdate).not.toHaveBeenCalled();
    expect(body.error).toContain('must be a boolean');
  });
});
