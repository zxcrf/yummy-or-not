/**
 * Regression test for #32 — "Unsupported FormDataPart implementation".
 *
 * Expo SDK 56's custom fetch requires FormData file entries to be Blob/File,
 * not the legacy RN `{ uri, name, type }` convention. This test asserts
 * createTaste converts an RNFile to a Blob before appending to FormData.
 */

import { createTaste, setAuthToken } from '../api-client';

let lastFetchArgs: { url: string; init?: RequestInit } | null = null;

beforeEach(() => {
  lastFetchArgs = null;
  setAuthToken('test-token');

  // Mock global fetch: intercept the API call, capture the body.
  // If the code does `fetch(photo.uri)` to read the file into a Blob,
  // respond with a fake Blob for file:// URIs.
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();

    // Local file fetch — return a fake blob
    if (url.startsWith('file://')) {
      const blob = new Blob(['fake-image-bytes'], { type: 'image/jpeg' });
      return new Response(blob);
    }

    // API call — capture and return success
    lastFetchArgs = { url, init };
    return new Response(JSON.stringify({
      id: '1', name: 'test', verdict: 'yummy', tags: [],
      image: '', createdAt: new Date().toISOString(),
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as jest.Mock;
});

afterEach(() => {
  jest.restoreAllMocks();
});

it('appends photo as Blob to FormData, not raw RN file object', async () => {
  const rnFile = { uri: 'file:///tmp/photo.jpg', name: 'photo.jpg', type: 'image/jpeg' };
  const input = { name: 'Latte', verdict: 'yum' as const, tags: ['Coffee'] };

  await createTaste(input, rnFile);

  expect(lastFetchArgs).not.toBeNull();
  const body = lastFetchArgs!.init?.body;
  expect(body).toBeInstanceOf(FormData);

  const fd = body as FormData;
  const photoEntry = fd.get('photo');

  // The critical assertion: photo must be a Blob/File, NOT a plain object.
  // Before the fix, this was { uri, name, type } which Expo 56 can't serialize.
  expect(photoEntry).toBeInstanceOf(Blob);
});

it('preserves filename on the Blob entry', async () => {
  const rnFile = { uri: 'file:///tmp/yummy.jpg', name: 'yummy.jpg', type: 'image/jpeg' };
  const input = { name: 'Ramen', verdict: 'meh' as const, tags: [] as string[] };

  await createTaste(input, rnFile);

  const fd = lastFetchArgs!.init?.body as FormData;
  const photoEntry = fd.get('photo');
  // File extends Blob — if appended with a filename, it should be a File
  expect(photoEntry).toBeInstanceOf(Blob);
  if (photoEntry instanceof File) {
    expect(photoEntry.name).toBe('yummy.jpg');
  }
});

it('still appends text fields correctly', async () => {
  const rnFile = { uri: 'file:///tmp/photo.jpg', name: 'photo.jpg', type: 'image/jpeg' };
  const input = { name: 'Burger', verdict: 'nah' as const, place: 'Downtown', price: '12', notes: 'meh', tags: ['Burger', 'Spicy'] };

  await createTaste(input, rnFile);

  const fd = lastFetchArgs!.init?.body as FormData;
  expect(fd.get('name')).toBe('Burger');
  expect(fd.get('verdict')).toBe('nah');
  expect(fd.get('place')).toBe('Downtown');
  expect(fd.get('price')).toBe('12');
  expect(fd.get('notes')).toBe('meh');
  expect(fd.getAll('tags')).toEqual(['Burger', 'Spicy']);
});
