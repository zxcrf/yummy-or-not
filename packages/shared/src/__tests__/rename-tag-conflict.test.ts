/**
 * Regression test: renameTag on a 409 name_conflict response must throw an
 * Error whose message is the machine-readable code "name_conflict", not a raw
 * HTTP status string.
 *
 * Pins the apiFetch change that parses JSON error bodies so callers can detect
 * specific error conditions without string-matching a status line.
 */

import { renameTag, setAuthToken } from '../api-client';

const FAKE_BASE = 'http://localhost';

beforeAll(() => {
  // Point the client at our fake base so fetch calls are predictable.
  // EXPO_PUBLIC_API_URL is read at module load time; override via globalThis.fetch mock instead.
  setAuthToken('test-token');
});

afterAll(() => {
  setAuthToken(null);
});

function makeFetch(status: number, body: unknown) {
  return jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  });
}

describe('renameTag — 409 name_conflict', () => {
  it('throws an Error with message "name_conflict" on a 409 response', async () => {
    global.fetch = makeFetch(409, { error: 'name_conflict' });

    await expect(renameTag('some-id', { name: 'coffee' })).rejects.toThrow(
      'name_conflict'
    );
  });

  it('thrown error message is exactly the server code, not an http_N string', async () => {
    global.fetch = makeFetch(409, { error: 'name_conflict' });

    let caughtMessage = '';
    try {
      await renameTag('some-id', { name: 'coffee' });
    } catch (err) {
      caughtMessage = (err as Error).message;
    }
    // Must be the machine-readable code, not e.g. "API PATCH ... → 409: ..."
    expect(caughtMessage).toBe('name_conflict');
  });

  it('throws "not_found" for a 404 response', async () => {
    global.fetch = makeFetch(404, { error: 'not_found' });

    await expect(renameTag('missing-id', { name: 'anything' })).rejects.toThrow(
      'not_found'
    );
  });

  it('falls back to http_N when the error body has no error field', async () => {
    global.fetch = makeFetch(500, { message: 'something blew up' });

    await expect(renameTag('some-id', { name: 'x' })).rejects.toThrow('http_500');
  });
});
