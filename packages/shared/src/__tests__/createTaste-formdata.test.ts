/**
 * Regression tests for the native (RN) photo upload path in createTaste.
 *
 * The environment here simulates Expo SDK 56 on Android/iOS, where the photo
 * upload kept breaking:
 *
 * - #32 — "Unsupported FormDataPart implementation": expo/fetch's
 *   convertFormData only serializes parts that are strings, Blobs, or objects
 *   exposing `bytes()` (expo-file-system File / ExpoBlob). The legacy RN
 *   `{ uri, name, type }` convention is rejected.
 *
 * - "Creating blobs from 'ArrayBuffer' and 'ArrayBufferView' are not
 *   supported": expo/fetch's `Response.blob()` is `new Blob([arrayBuffer])`
 *   against the global RN Blob, whose constructor throws on ArrayBuffer parts.
 *   So `fetch(uri).then((r) => r.blob())` crashes on device — the fix must
 *   read the file via `arrayBuffer()` and never construct a Blob/File.
 *
 * To pin device behavior (Node's undici fetch/Blob/FormData are all
 * spec-compliant and would mask both bugs), the mocks below make
 * `Response.blob()` throw the RN error and use an RN-style FormData that
 * stores appended values as-is and ignores append's third argument.
 */

import { createTaste, setAuthToken } from '../api-client';

const RN_BLOB_ERROR =
  "Creating blobs from 'ArrayBuffer' and 'ArrayBufferView' are not supported";

/** RN's classic FormData: append(key, value) — 3rd arg ignored, no serialization. */
class RNLikeFormData {
  parts: Array<[string, unknown]> = [];
  append(name: string, value: unknown) {
    this.parts.push([name, value]);
  }
  getAll(name: string): unknown[] {
    return this.parts.filter(([n]) => n === name).map(([, v]) => v);
  }
  get(name: string): unknown {
    return this.getAll(name)[0] ?? null;
  }
}

const OriginalFormData = global.FormData;
let lastFetchArgs: { url: string; init?: RequestInit } | null = null;

beforeEach(() => {
  lastFetchArgs = null;
  setAuthToken('test-token');
  global.FormData = RNLikeFormData as unknown as typeof FormData;

  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();

    // Local file fetch — arrayBuffer() works, blob() throws like RN does.
    if (url.startsWith('file://')) {
      const res = new Response(new TextEncoder().encode('fake-image-bytes'), {
        headers: { 'Content-Type': 'image/jpeg' },
      });
      Object.defineProperty(res, 'blob', {
        value: () => {
          throw new TypeError(RN_BLOB_ERROR);
        },
      });
      return res;
    }

    // API call — capture and return success
    lastFetchArgs = { url, init };
    return new Response(JSON.stringify({
      id: '1', name: 'test', verdict: 'yum', tags: [],
      image: '', createdAt: new Date().toISOString(),
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as jest.Mock;
});

afterEach(() => {
  global.FormData = OriginalFormData;
  jest.restoreAllMocks();
});

const rnFile = { uri: 'file:///tmp/photo.jpg', name: 'photo.jpg', type: 'image/jpeg' };

it('saves with a photo even though Response.blob() throws (Android RN Blob)', async () => {
  const input = { name: 'Latte', verdict: 'yum' as const, tags: ['Coffee'] };

  // Before the fix this rejected with RN_BLOB_ERROR — the exact user-visible
  // crash — because the photo was read via fetch(uri).then((r) => r.blob()).
  await expect(createTaste(input, rnFile)).resolves.toMatchObject({ id: '1' });
});

it('appends a bytes()-shaped part with filename and content type', async () => {
  await createTaste({ name: 'Ramen', verdict: 'meh' as const, tags: [] }, rnFile);

  expect(lastFetchArgs).not.toBeNull();
  const fd = lastFetchArgs!.init?.body as unknown as RNLikeFormData;
  expect(fd).toBeInstanceOf(RNLikeFormData);

  const photo = fd.get('photo') as {
    uri?: string;
    name: string;
    type: string;
    size: number;
    bytes: () => Uint8Array;
  };

  // expo/fetch's convertFormData accepts string | Blob | { bytes() } entries
  // and reads filename/content-type from the part's `name`/`type`. The legacy
  // RN { uri } descriptor (#32) and Blob/File construction are both off-limits.
  expect(photo).not.toBeNull();
  expect(photo.uri).toBeUndefined();
  expect(typeof photo.bytes).toBe('function');
  expect(photo.name).toBe('photo.jpg');
  expect(photo.type).toBe('image/jpeg');

  const bytes = photo.bytes();
  expect(bytes).toBeInstanceOf(Uint8Array);
  expect(photo.size).toBe(bytes.byteLength);
  expect(new TextDecoder().decode(bytes)).toBe('fake-image-bytes');
});

it('still appends text fields correctly', async () => {
  const input = { name: 'Burger', verdict: 'nah' as const, place: 'Downtown', price: '12', notes: 'meh', tags: ['Burger', 'Spicy'] };

  await createTaste(input, rnFile);

  const fd = lastFetchArgs!.init?.body as unknown as RNLikeFormData;
  expect(fd.get('name')).toBe('Burger');
  expect(fd.get('verdict')).toBe('nah');
  expect(fd.get('place')).toBe('Downtown');
  expect(fd.get('price')).toBe('12');
  expect(fd.get('notes')).toBe('meh');
  expect(fd.getAll('tags')).toEqual(['Burger', 'Spicy']);
});

it('passes a browser File straight through (web path)', async () => {
  const file = new File(['web-bytes'], 'web.jpg', { type: 'image/jpeg' });

  await createTaste({ name: 'Web', verdict: 'yum' as const, tags: [] }, file);

  const fd = lastFetchArgs!.init?.body as unknown as RNLikeFormData;
  expect(fd.get('photo')).toBe(file);
});
