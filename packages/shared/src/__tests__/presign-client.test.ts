// Tests for the S3b-media avatar upload API-client functions (api-client.ts):
//
//   requestAvatarPresign(input)              → POST /api/uploads/presign
//   uploadToPresignedUrl(url, headers, uri)  → PUT via expo-file-system/legacy
//   updateUser({ avatar })                   → PATCH /api/user  (the commit)
//
// Pins the contract the mobile avatar flow depends on: correct method/path,
// auth header forwarding on the presign call, that the PUT replays the signed
// headers WITHOUT an auth header (the presigned URL is the capability), that a
// non-2xx PUT throws, and that updateUser forwards `avatar` to the body.

// The PUT path requires the legacy expo-file-system API (SDK 54+ moved
// uploadAsync there). Mock it so we can assert the call shape without a device.
const mockUploadAsync = jest.fn();
jest.mock(
  'expo-file-system/legacy',
  () => ({
    uploadAsync: (...args: unknown[]) => mockUploadAsync(...args),
    FileSystemUploadType: { BINARY_CONTENT: 0, MULTIPART: 1 },
  }),
  { virtual: true },
);

import {
  requestAvatarPresign,
  uploadToPresignedUrl,
  updateUser,
  setAuthToken,
} from '../api-client';

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
  mockUploadAsync.mockReset();
  setAuthToken('test-token');
});

describe('requestAvatarPresign', () => {
  it('POSTs /api/uploads/presign with the kind/contentType and forwards auth', async () => {
    mockJson(200, {
      uploadUrl: 'https://r2.example/u/u1/avatar/abc.jpg?sig=xyz',
      key: 'u/u1/avatar/abc.jpg',
      headers: { 'Content-Type': 'image/jpeg' },
    });

    const out = await requestAvatarPresign({ kind: 'avatar', contentType: 'image/jpeg' });

    expect(lastFetch?.url).toMatch(/\/api\/uploads\/presign$/);
    expect(lastFetch?.init?.method).toBe('POST');
    const headers = new Headers(lastFetch?.init?.headers);
    expect(headers.get('Authorization')).toBe('Bearer test-token');
    expect(JSON.parse(lastFetch?.init?.body as string)).toEqual({
      kind: 'avatar',
      contentType: 'image/jpeg',
    });

    expect(out.uploadUrl).toMatch(/^https:\/\/r2\.example\//);
    expect(out.key).toBe('u/u1/avatar/abc.jpg');
    expect(out.headers).toEqual({ 'Content-Type': 'image/jpeg' });
  });

  it('surfaces the server error code on failure (e.g. unsupported_content_type)', async () => {
    mockJson(400, { error: 'unsupported_content_type' });
    await expect(
      requestAvatarPresign({ kind: 'avatar', contentType: 'image/gif' }),
    ).rejects.toThrow('unsupported_content_type');
  });
});

describe('uploadToPresignedUrl', () => {
  it('PUTs the file via the legacy BINARY_CONTENT path, replaying the signed headers and NO auth header', async () => {
    mockUploadAsync.mockResolvedValue({ status: 200, body: '' });

    await uploadToPresignedUrl(
      'https://r2.example/u/u1/avatar/abc.jpg?sig=xyz',
      { 'Content-Type': 'image/jpeg' },
      'file:///tmp/avatar.jpg',
    );

    expect(mockUploadAsync).toHaveBeenCalledTimes(1);
    const [url, fileUri, options] = mockUploadAsync.mock.calls[0];
    expect(url).toBe('https://r2.example/u/u1/avatar/abc.jpg?sig=xyz');
    expect(fileUri).toBe('file:///tmp/avatar.jpg');
    expect(options.httpMethod).toBe('PUT');
    // BINARY_CONTENT enum value (0) — the proven Expo direct-to-S3 PUT.
    expect(options.uploadType).toBe(0);
    // Only the presign-signed headers ride the PUT; no Authorization bearer.
    expect(options.headers).toEqual({ 'Content-Type': 'image/jpeg' });
    expect(options.headers.Authorization).toBeUndefined();
  });

  it('throws when the PUT returns a non-2xx status (keeps the old avatar)', async () => {
    mockUploadAsync.mockResolvedValue({ status: 403, body: 'AccessDenied' });
    await expect(
      uploadToPresignedUrl('https://r2.example/x', { 'Content-Type': 'image/jpeg' }, 'file:///x.jpg'),
    ).rejects.toThrow(/upload_failed_403/);
  });
});

describe('updateUser forwards avatar (the commit)', () => {
  it('PATCHes /api/user with { avatar: key } and returns the resolved user', async () => {
    mockJson(200, {
      user: { id: 'u1', avatar: 'https://r2.example/signed-get?sig=abc' },
    });

    const out = await updateUser({ avatar: 'u/u1/avatar/abc.jpg' });

    expect(lastFetch?.url).toMatch(/\/api\/user$/);
    expect(lastFetch?.init?.method).toBe('PATCH');
    expect(JSON.parse(lastFetch?.init?.body as string)).toEqual({
      avatar: 'u/u1/avatar/abc.jpg',
    });
    // The server resolves the bare key to a fetchable signed URL on the way out.
    expect(out.user.avatar).toBe('https://r2.example/signed-get?sig=abc');
  });
});
