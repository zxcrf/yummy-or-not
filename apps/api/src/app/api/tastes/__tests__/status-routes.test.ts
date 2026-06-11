// Route-handler tests for the to-taste status feature — POST /api/tastes and
// PATCH /api/tastes/:id. The DB layer is mocked; these pin the HTTP contract:
//   - POST tasted without verdict → 400 verdict_required (was a 500 pre-0006)
//   - POST todo without verdict → 201 with verdict null + warnBeforeBuy false
//   - GET passes the status param through (default 'tasted')
//   - PATCH maps updateTaste's error strings to 400 with the matching code
//   - PATCH promote success returns the Taste

const mockGetUserFromRequest = jest.fn();
const mockListTastes = jest.fn();
const mockCreateTaste = jest.fn();
const mockCountTastes = jest.fn();
const mockUpdateTaste = jest.fn();

jest.mock('@/lib/auth', () => ({
  getUserFromRequest: (...args: unknown[]) => mockGetUserFromRequest(...args),
}));

jest.mock('@/lib/cors', () => ({
  corsPreflight: jest.fn(() => new Response(null, { status: 204 })),
  withCors: jest.fn((res: Response) => res),
}));

jest.mock('@/lib/db', () => ({
  listTastes: (...args: unknown[]) => mockListTastes(...args),
  createTaste: (...args: unknown[]) => mockCreateTaste(...args),
  countTastes: (...args: unknown[]) => mockCountTastes(...args),
  updateTaste: (...args: unknown[]) => mockUpdateTaste(...args),
  // [id]/route.ts also imports these; stub so the module loads.
  getTaste: jest.fn(),
  deleteTaste: jest.fn(),
  getRawImage: jest.fn(),
}));

jest.mock('@/lib/storage', () => ({
  uploadPhoto: jest.fn(),
  deletePhoto: jest.fn(),
}));

import { GET, POST } from '../route';
import { PATCH } from '../[id]/route';
import { NextRequest } from 'next/server';

function jsonReq(method: string, body: unknown, url = 'http://localhost/api/tastes'): NextRequest {
  return new NextRequest(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function bodyOf(res: Response): Promise<Record<string, unknown>> {
  return JSON.parse(await res.text());
}

const authedUser = { id: 'u1', plan: 'free' };

beforeEach(() => {
  jest.clearAllMocks();
  mockGetUserFromRequest.mockResolvedValue(authedUser);
  mockCountTastes.mockResolvedValue(0);
});

describe('POST /api/tastes status validation', () => {
  it('returns 400 verdict_required for a tasted row with no verdict', async () => {
    const res = await POST(jsonReq('POST', { name: 'No Verdict' }));
    expect(res.status).toBe(400);
    expect((await bodyOf(res)).error).toBe('verdict_required');
    expect(mockCreateTaste).not.toHaveBeenCalled();
  });

  it('accepts a todo row with no verdict → 201, verdict null, warnBeforeBuy false', async () => {
    mockCreateTaste.mockResolvedValue({
      id: 't1', status: 'todo', verdict: null, warnBeforeBuy: false, name: 'Wishlist',
    });
    const res = await POST(jsonReq('POST', { name: 'Wishlist', status: 'todo' }));
    expect(res.status).toBe(201);
    const body = await bodyOf(res);
    expect(body.status).toBe('todo');
    expect(body.verdict).toBeNull();
    expect(body.warnBeforeBuy).toBe(false);
    expect(mockCreateTaste).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({ status: 'todo' }),
    );
  });

  it('accepts a tasted row with a verdict → 201', async () => {
    mockCreateTaste.mockResolvedValue({ id: 't2', status: 'tasted', verdict: 'yum' });
    const res = await POST(jsonReq('POST', { name: 'Eaten', verdict: 'yum' }));
    expect(res.status).toBe(201);
  });
});

describe('GET /api/tastes status param', () => {
  it("defaults to status 'tasted' when the param is absent", async () => {
    mockListTastes.mockResolvedValue([]);
    await GET(new NextRequest('http://localhost/api/tastes'));
    expect(mockListTastes).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({ status: 'tasted' }),
    );
  });

  it("passes status 'all' through", async () => {
    mockListTastes.mockResolvedValue([]);
    await GET(new NextRequest('http://localhost/api/tastes?status=all'));
    expect(mockListTastes).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({ status: 'all' }),
    );
  });

  it('falls back to tasted for an unknown status value', async () => {
    mockListTastes.mockResolvedValue([]);
    await GET(new NextRequest('http://localhost/api/tastes?status=bogus'));
    expect(mockListTastes).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({ status: 'tasted' }),
    );
  });
});

describe('PATCH /api/tastes/:id status errors', () => {
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

  it('maps invalid_status_transition to 400', async () => {
    mockUpdateTaste.mockResolvedValue('invalid_status_transition');
    const res = await PATCH(jsonReq('PATCH', { status: 'todo' }, 'http://localhost/api/tastes/t1'), ctx('t1'));
    expect(res.status).toBe(400);
    expect((await bodyOf(res)).error).toBe('invalid_status_transition');
  });

  it('maps verdict_required to 400', async () => {
    mockUpdateTaste.mockResolvedValue('verdict_required');
    const res = await PATCH(jsonReq('PATCH', { status: 'tasted' }, 'http://localhost/api/tastes/t1'), ctx('t1'));
    expect(res.status).toBe(400);
    expect((await bodyOf(res)).error).toBe('verdict_required');
  });

  it('returns 404 when updateTaste returns null (not found)', async () => {
    mockUpdateTaste.mockResolvedValue(null);
    const res = await PATCH(jsonReq('PATCH', { name: 'x' }, 'http://localhost/api/tastes/t1'), ctx('t1'));
    expect(res.status).toBe(404);
  });

  it('returns the promoted Taste on success', async () => {
    mockUpdateTaste.mockResolvedValue({ id: 't1', status: 'tasted', verdict: 'yum' });
    const res = await PATCH(jsonReq('PATCH', { status: 'tasted', verdict: 'yum' }, 'http://localhost/api/tastes/t1'), ctx('t1'));
    expect(res.status).toBe(200);
    expect((await bodyOf(res)).status).toBe('tasted');
  });
});
