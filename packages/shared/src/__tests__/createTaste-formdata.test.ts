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

import { createTaste, updateTaste, setAuthToken } from '../api-client';

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
  const input = {
    name: 'Burger',
    verdict: 'nah' as const,
    place: 'Downtown',
    price: '12',
    notes: 'meh',
    lat: -31.9523,
    lng: 115.8613,
    tags: ['Burger', 'Spicy'],
  };

  await createTaste(input, rnFile);

  const fd = lastFetchArgs!.init?.body as unknown as RNLikeFormData;
  expect(fd.get('name')).toBe('Burger');
  expect(fd.get('verdict')).toBe('nah');
  expect(fd.get('place')).toBe('Downtown');
  expect(fd.get('price')).toBe('12');
  expect(fd.get('notes')).toBe('meh');
  expect(fd.get('lat')).toBe('-31.9523');
  expect(fd.get('lng')).toBe('115.8613');
  expect(fd.getAll('tags')).toEqual(['Burger', 'Spicy']);
});

it('appends tasterId on the multipart (photo) path when an active taster is set', async () => {
  // S3b regression: a save WITH a photo must still carry the active persona.
  // The bug dropped tasterId on the multipart path, so every photo save fell
  // back to the self-taster regardless of the selected taster.
  await createTaste(
    { name: 'Partner Dish', verdict: 'yum' as const, tags: [], tasterId: 'ts_partner' },
    rnFile,
  );

  const fd = lastFetchArgs!.init?.body as unknown as RNLikeFormData;
  expect(fd.get('tasterId')).toBe('ts_partner');
});

it('omits tasterId on the multipart path when none is active (self default)', async () => {
  await createTaste({ name: 'Just Me', verdict: 'yum' as const, tags: [] }, rnFile);

  const fd = lastFetchArgs!.init?.body as unknown as RNLikeFormData;
  expect(fd.get('tasterId')).toBeNull();
});

it('omits location fields when they are not provided', async () => {
  await createTaste({ name: 'No location', verdict: 'yum' as const, tags: [] }, rnFile);

  const fd = lastFetchArgs!.init?.body as unknown as RNLikeFormData;
  expect(fd.get('lat')).toBeNull();
  expect(fd.get('lng')).toBeNull();
});

it('passes a browser File straight through (web path)', async () => {
  const file = new File(['web-bytes'], 'web.jpg', { type: 'image/jpeg' });

  await createTaste({ name: 'Web', verdict: 'yum' as const, tags: [] }, file);

  const fd = lastFetchArgs!.init?.body as unknown as RNLikeFormData;
  expect(fd.get('photo')).toBe(file);
});

it('updateTaste uses JSON PATCH when no photo is supplied', async () => {
  await updateTaste('taste-1', { name: 'Renamed' });

  expect(lastFetchArgs).not.toBeNull();
  expect(lastFetchArgs!.url).toBe('/api/tastes/taste-1');
  expect(lastFetchArgs!.init?.method).toBe('PATCH');
  expect(new Headers(lastFetchArgs!.init?.headers).get('Content-Type')).toBe('application/json');
  expect(lastFetchArgs!.init?.body).toBe(JSON.stringify({ name: 'Renamed' }));
});

it('updateTaste uses multipart PATCH with a bytes()-shaped photo part', async () => {
  await updateTaste('taste-1', { name: 'Photo Rename', tags: ['Coffee'] }, rnFile);

  expect(lastFetchArgs).not.toBeNull();
  expect(lastFetchArgs!.url).toBe('/api/tastes/taste-1');
  expect(lastFetchArgs!.init?.method).toBe('PATCH');
  expect(new Headers(lastFetchArgs!.init?.headers).get('Content-Type')).toBeNull();

  const fd = lastFetchArgs!.init?.body as unknown as RNLikeFormData;
  expect(fd).toBeInstanceOf(RNLikeFormData);
  expect(fd.get('name')).toBe('Photo Rename');
  expect(fd.getAll('tags')).toEqual(['Coffee']);
  const photo = fd.get('photo') as { uri?: string; name: string; type: string; bytes: () => Uint8Array };
  expect(photo.uri).toBeUndefined();
  expect(photo.name).toBe('photo.jpg');
  expect(photo.type).toBe('image/jpeg');
  expect(new TextDecoder().decode(photo.bytes())).toBe('fake-image-bytes');
});
