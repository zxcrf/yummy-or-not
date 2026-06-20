jest.mock('@/lib/db', () => ({
  getTaste: jest.fn(),
  updateTaste: jest.fn(),
  deleteTaste: jest.fn(),
  getRawImage: jest.fn(),
  getRawClipKey: jest.fn(),
}));

jest.mock('@/lib/storage', () => ({
  uploadPhoto: jest.fn(async (_buffer: Buffer, opts: { key: string }) => opts.key),
  deletePhoto: jest.fn().mockResolvedValue(undefined),
  assertMediaAllowed: jest.fn().mockReturnValue(null),
}));

jest.mock('@/lib/image-variants', () => ({
  origKey: jest.fn((_uuid: string, ext: string) => `t/11111111-1111-1111-1111-111111111111/orig.${ext}`),
  variantKeys: jest.fn((ok: string) => ({
    orig: ok,
    thumb: ok.replace(/orig\.[^.]+$/, 'thumb.webp'),
    display: ok.replace(/orig\.[^.]+$/, 'display.webp'),
  })),
  makeVariants: jest.fn(async () => ({
    thumb: Buffer.from('thumb'),
    display: Buffer.from('display'),
  })),
  safeExt: jest.fn().mockReturnValue('jpg'),
  isVariantKey: jest.fn((v: string) => /^t\/[0-9a-f-]{36}\/orig\.[a-z0-9]+$/.test(v)),
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

import { PATCH } from '../route';
import { getTaste, updateTaste } from '@/lib/db';
import { uploadPhoto, deletePhoto, assertMediaAllowed } from '@/lib/storage';
import { getUserFromRequest } from '@/lib/auth';

const mockedGetTaste = jest.mocked(getTaste);
const mockedUpdateTaste = jest.mocked(updateTaste);
const mockedUpload = jest.mocked(uploadPhoto);
const mockedDelete = jest.mocked(deletePhoto);
const mockedAuth = jest.mocked(getUserFromRequest);
const mockedGate = jest.mocked(assertMediaAllowed);

const user = {
  id: 'u1',
  displayName: 'A',
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

const taste = {
  id: 't1',
  name: 'Old',
  place: '',
  price: '',
  status: 'tasted',
  verdict: 'yum',
  tags: [],
  boughtCount: 1,
  warnBeforeBuy: false,
  purchases: [],
  date: 'today',
  notes: '',
  image: '',
  imageThumb: '',
  imageDisplay: '',
  imageKey: '',
  createdAt: '2026-01-01T00:00:00.000Z',
};

function ctx(id = 't1') {
  return { params: Promise.resolve({ id }) };
}

function jsonReq(body: unknown) {
  return new Request('http://localhost/api/tastes/t1', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as never;
}

function multipartReq(fileType = 'image/jpeg', fileName = 'photo.jpg') {
  const form = new FormData();
  form.append('name', 'New');
  form.append('verdict', 'yum');
  form.append('photo', new Blob([new Uint8Array([1, 2, 3])], { type: fileType }), fileName);
  return new Request('http://localhost/api/tastes/t1', {
    method: 'PATCH',
    body: form,
  }) as never;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedAuth.mockResolvedValue(user);
  mockedGate.mockReturnValue(null);
  mockedGetTaste.mockResolvedValue(taste as never);
  mockedUpdateTaste.mockResolvedValue({ taste: { ...taste, name: 'New' }, previousImage: null } as never);
});

describe('PATCH /api/tastes/[id] photo upload', () => {
  it('adds an image through server-generated variant keys', async () => {
    const res = await PATCH(multipartReq(), ctx());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.name).toBe('New');
    expect(mockedGetTaste).toHaveBeenCalledWith('u1', 't1');
    expect(mockedUpload).toHaveBeenCalledTimes(3);
    expect(mockedUpdateTaste).toHaveBeenCalledWith(
      'u1',
      't1',
      { name: 'New', verdict: 'yum' },
      { imageKey: 't/11111111-1111-1111-1111-111111111111/orig.jpg' },
    );
  });

  it('replaces an old variant image and deletes old sibling objects', async () => {
    const oldKey = 't/99999999-9999-9999-9999-999999999999/orig.jpg';
    mockedUpdateTaste.mockResolvedValueOnce({
      taste: { ...taste, imageKey: 't/11111111-1111-1111-1111-111111111111/orig.jpg' },
      previousImage: oldKey,
    } as never);

    const res = await PATCH(multipartReq(), ctx());

    expect(res.status).toBe(200);
    expect(mockedDelete).toHaveBeenCalledWith(oldKey);
    expect(mockedDelete).toHaveBeenCalledWith('t/99999999-9999-9999-9999-999999999999/thumb.webp');
    expect(mockedDelete).toHaveBeenCalledWith('t/99999999-9999-9999-9999-999999999999/display.webp');
  });

  it('returns 404 for a foreign id before upload', async () => {
    mockedGetTaste.mockResolvedValueOnce(null);

    const res = await PATCH(multipartReq(), ctx());
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe('Not found');
    expect(mockedUpload).not.toHaveBeenCalled();
    expect(mockedUpdateTaste).not.toHaveBeenCalled();
  });

  it('rejects video bytes by media gate with no image write', async () => {
    mockedGate.mockReturnValueOnce('media_not_enabled');

    const res = await PATCH(multipartReq('video/mp4', 'clip.mp4'), ctx());
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toBe('media_not_enabled');
    expect(mockedUpload).not.toHaveBeenCalled();
    expect(mockedUpdateTaste).not.toHaveBeenCalled();
  });

  it('parses lat/lng from a multipart PATCH (pin edited alongside a photo)', async () => {
    const form = new FormData();
    form.append('name', 'New');
    form.append('lat', '31.2304');
    form.append('lng', '121.4737');
    form.append('photo', new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }), 'photo.jpg');
    const req = new Request('http://localhost/api/tastes/t1', { method: 'PATCH', body: form }) as never;

    await PATCH(req, ctx());

    expect(mockedUpdateTaste).toHaveBeenCalledWith(
      'u1',
      't1',
      expect.objectContaining({ name: 'New', lat: 31.2304, lng: 121.4737 }),
      { imageKey: 't/11111111-1111-1111-1111-111111111111/orig.jpg' },
    );
  });

  it('reads an empty lat/lng multipart field as clear-the-pin (null)', async () => {
    const form = new FormData();
    form.append('name', 'New');
    form.append('lat', '');
    form.append('lng', '');
    form.append('photo', new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }), 'photo.jpg');
    const req = new Request('http://localhost/api/tastes/t1', { method: 'PATCH', body: form }) as never;

    await PATCH(req, ctx());

    const patch = mockedUpdateTaste.mock.calls[0][2];
    expect(patch).toMatchObject({ lat: null, lng: null });
  });

  it('keeps JSON-only PATCH behavior unchanged', async () => {
    mockedUpdateTaste.mockResolvedValueOnce({ ...taste, name: 'Json' } as never);

    const res = await PATCH(jsonReq({ name: 'Json' }), ctx());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.name).toBe('Json');
    expect(mockedGetTaste).not.toHaveBeenCalled();
    expect(mockedUpload).not.toHaveBeenCalled();
    expect(mockedUpdateTaste).toHaveBeenCalledWith('u1', 't1', { name: 'Json' });
  });
});
