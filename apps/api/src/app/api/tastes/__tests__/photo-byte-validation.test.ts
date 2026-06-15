// Regression test: media-gate bypass via image-disguised video.
//
// Attack: an attacker renames video.mp4 → photo.jpg and POSTs it as
// multipart with Content-Type image/jpeg. assertMediaAllowed sees a
// non-video content-type → gate passes. makeVariants (sharp) then fails
// on the video bytes. Before this fix, the catch-fallback would upload the
// raw buffer — storing arbitrary non-image bytes and bypassing the media gate.
//
// Fix: the catch block probes sharp().metadata() before falling back.
// If the buffer is not a decodable image (metadata throws / unknown format),
// the route returns 400 invalid_image and does NOT call uploadPhoto.
//
// This test pins that the raw-fallback path is gated, not the happy
// (makeVariants succeeds) path.

jest.mock('@/lib/db', () => ({
  createTaste: jest.fn(),
  listTastes: jest.fn(),
  countTastes: jest.fn(),
  CreateTasteError: class CreateTasteError extends Error {
    code: string;
    constructor(code: string) {
      super(code);
      this.code = code;
      this.name = 'CreateTasteError';
    }
  },
}));

// sharp is mocked so we can simulate makeVariants throwing + metadata
// failing (video bytes) or succeeding (valid image bytes).
jest.mock('sharp', () => {
  // Each test overrides makeVariantsThrows / metadataThrows / metadataFormat
  // via globals set in beforeEach.
  return jest.fn(() => ({
    rotate: jest.fn().mockReturnThis(),
    clone: jest.fn().mockReturnThis(),
    resize: jest.fn().mockReturnThis(),
    webp: jest.fn().mockReturnThis(),
    toBuffer: jest.fn().mockImplementation(async () => {
      if ((globalThis as Record<string, unknown>).__makeVariantsThrows) {
        throw new Error('Input file contains unsupported image format');
      }
      return Buffer.from('fake-webp');
    }),
    metadata: jest.fn().mockImplementation(async () => {
      if ((globalThis as Record<string, unknown>).__metadataThrows) {
        throw new Error('Input file contains unsupported image format');
      }
      return { format: (globalThis as Record<string, unknown>).__metadataFormat ?? 'jpeg' };
    }),
    failOn: jest.fn().mockReturnThis(),
  }));
});

// sharp is used via dynamic import('sharp') in the route. The jest.mock above
// covers the static require path; ensure the dynamic import resolves the same mock.
jest.mock(
  'sharp',
  () => {
    const sharpMock = jest.fn(() => ({
      rotate: jest.fn().mockReturnThis(),
      clone: jest.fn().mockReturnThis(),
      resize: jest.fn().mockReturnThis(),
      webp: jest.fn().mockReturnThis(),
      toBuffer: jest.fn().mockImplementation(async () => {
        if ((globalThis as Record<string, unknown>).__makeVariantsThrows) {
          throw new Error('Input file contains unsupported image format');
        }
        return Buffer.from('fake-webp');
      }),
      metadata: jest.fn().mockImplementation(async () => {
        if ((globalThis as Record<string, unknown>).__metadataThrows) {
          throw new Error('Input file contains unsupported image format');
        }
        return { format: (globalThis as Record<string, unknown>).__metadataFormat ?? 'jpeg' };
      }),
      failOn: jest.fn().mockReturnThis(),
    }));
    return { default: sharpMock, __esModule: true };
  },
  { virtual: false }
);

jest.mock('@/lib/storage', () => ({
  uploadPhoto: jest.fn().mockResolvedValue('t/uuid/orig.jpg'),
  deletePhoto: jest.fn().mockResolvedValue(undefined),
  assertMediaAllowed: jest.fn().mockReturnValue(null),
  headObject: jest.fn(),
  CLIP_MAX_BYTES: 20 * 1024 * 1024,
}));

jest.mock('@/lib/image-variants', () => ({
  origKey: jest.fn((_uuid: string, ext: string) => `t/fake-uuid/orig.${ext}`),
  variantKeys: jest.fn((_ok: string) => ({
    thumb: 't/fake-uuid/thumb.webp',
    display: 't/fake-uuid/display.webp',
  })),
  makeVariants: jest.fn().mockImplementation(async (_buf: Buffer) => {
    if ((globalThis as Record<string, unknown>).__makeVariantsThrows) {
      throw new Error('Input file contains unsupported image format');
    }
    return { thumb: Buffer.from('fake-thumb'), display: Buffer.from('fake-display') };
  }),
  safeExt: jest.fn().mockReturnValue('jpg'),
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

import type { NextRequest } from 'next/server';
import { POST } from '../route';
import { createTaste, countTastes } from '@/lib/db';
import { uploadPhoto, deletePhoto } from '@/lib/storage';
import { getUserFromRequest } from '@/lib/auth';

const mockedCreate = jest.mocked(createTaste);
const mockedCount = jest.mocked(countTastes);
const mockedUpload = jest.mocked(uploadPhoto);
const mockedDelete = jest.mocked(deletePhoto);
const mockedAuth = jest.mocked(getUserFromRequest);

const freeUser = {
  id: 'u1',
  displayName: 'Eve',
  phone: '',
  email: 'eve@example.com',
  avatar: '',
  locale: 'zh',
  plan: 'free' as const,
  warningsEnabled: true,
  locationEnabled: false,
  mediaEnabled: false,       // no media capability
  defaultVisibility: 'private' as const,
  createdAt: '2026-01-01T00:00:00.000Z',
};

/** Fake video bytes — starts with ftyp box (MP4 magic), not a JPEG SOI marker. */
const FAKE_MP4_BYTES = Buffer.from([
  0x00, 0x00, 0x00, 0x18, // box size
  0x66, 0x74, 0x79, 0x70, // 'ftyp'
  0x69, 0x73, 0x6f, 0x6d, // 'isom'
  0x00, 0x00, 0x02, 0x00,
  0x69, 0x73, 0x6f, 0x6d,
  0x69, 0x73, 0x6f, 0x32,
]);

function multipartReq(fileBytes: Buffer, mimeType: string, filename: string): NextRequest {
  const form = new FormData();
  form.append('name', 'Evil Snack');
  form.append('verdict', 'yum');
  form.append('photo', new Blob([new Uint8Array(fileBytes)], { type: mimeType }), filename);
  return new Request('http://localhost/api/tastes', {
    method: 'POST',
    body: form,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as unknown as NextRequest;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedAuth.mockResolvedValue(freeUser);
  mockedCount.mockResolvedValue(0);
  mockedCreate.mockResolvedValue({ id: 't1', name: 'Evil Snack' } as never);
  // Reset sharp simulation flags.
  (globalThis as Record<string, unknown>).__makeVariantsThrows = false;
  (globalThis as Record<string, unknown>).__metadataThrows = false;
  (globalThis as Record<string, unknown>).__metadataFormat = 'jpeg';
});

describe('POST /api/tastes — disguised-video byte-validation gate', () => {
  it('400 invalid_image when non-image bytes disguised as image/jpeg — no raw buffer stored', async () => {
    // Simulate: makeVariants throws (video bytes), metadata also throws (video bytes).
    (globalThis as Record<string, unknown>).__makeVariantsThrows = true;
    (globalThis as Record<string, unknown>).__metadataThrows = true;

    const res = await POST(multipartReq(FAKE_MP4_BYTES, 'image/jpeg', 'photo.jpg'));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('invalid_image');
    // The raw buffer must NOT have been uploaded.
    expect(mockedUpload).not.toHaveBeenCalled();
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it('400 invalid_image when makeVariants throws but metadata returns unknown format', async () => {
    // makeVariants fails; metadata "succeeds" but format is not in the allowed set.
    (globalThis as Record<string, unknown>).__makeVariantsThrows = true;
    (globalThis as Record<string, unknown>).__metadataThrows = false;
    (globalThis as Record<string, unknown>).__metadataFormat = 'mp4'; // not in allowlist

    const res = await POST(multipartReq(FAKE_MP4_BYTES, 'image/jpeg', 'photo.jpg'));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('invalid_image');
    expect(mockedUpload).not.toHaveBeenCalled();
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it('partial variant uploads are cleaned up before rejecting non-image bytes', async () => {
    (globalThis as Record<string, unknown>).__makeVariantsThrows = true;
    (globalThis as Record<string, unknown>).__metadataThrows = true;

    await POST(multipartReq(FAKE_MP4_BYTES, 'image/jpeg', 'photo.jpg'));

    // Partial orig/thumb/display keys must have been deleted (best-effort cleanup).
    expect(mockedDelete).toHaveBeenCalledWith('t/fake-uuid/orig.jpg');
    expect(mockedDelete).toHaveBeenCalledWith('t/fake-uuid/thumb.webp');
    expect(mockedDelete).toHaveBeenCalledWith('t/fake-uuid/display.webp');
  });
});
