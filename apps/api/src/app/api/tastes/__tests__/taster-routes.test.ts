// Route-handler tests for S3b taster attribution on /api/tastes. The DB layer
// is mocked; these pin the HTTP contract:
//
//   - POST /api/tastes with a taster_id in the JSON body passes it through to
//     createTaste (the active client taster tags the new record).
//   - POST /api/tastes WITHOUT a taster_id does not invent one — createTaste is
//     called with taster_id undefined (the DB layer applies the self-taster
//     default; covered in tasters-backfill.test.ts).
//   - GET /api/tastes?taster=<id> forwards the taster filter to listTastes.
//   - GET /api/tastes without ?taster forwards taster undefined (no filter).
//
// These FAIL today: the route does not read/forward taster_id. They PASS once
// S3b threads taster_id through POST and the ?taster filter through GET.

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

// The route imports CreateTasteError and does `err instanceof CreateTasteError`,
// so the mock must export the SAME class the route catches against.
// Class is defined inside the factory to avoid TDZ issues with jest.mock hoisting.
jest.mock('@/lib/db', () => {
  class CreateTasteError extends Error {
    constructor(public readonly code: 'invalid_taster') {
      super(code);
      this.name = 'CreateTasteError';
    }
  }
  return {
    listTastes: (...args: unknown[]) => mockListTastes(...args),
    createTaste: (...args: unknown[]) => mockCreateTaste(...args),
    countTastes: (...args: unknown[]) => mockCountTastes(...args),
    updateTaste: (...args: unknown[]) => mockUpdateTaste(...args),
    getTaste: jest.fn(),
    deleteTaste: jest.fn(),
    getRawImage: jest.fn(),
    CreateTasteError,
  };
});

// Retrieve the class from the mock so test code (new CreateTasteError(...)) uses
// the exact same reference that the route module sees via instanceof.
const { CreateTasteError } = jest.requireMock('@/lib/db') as {
  CreateTasteError: new (code: 'invalid_taster') => Error;
};

jest.mock('@/lib/storage', () => ({
  uploadPhoto: jest.fn(),
  deletePhoto: jest.fn(),
}));

import { GET, POST } from '../route';
import { NextRequest } from 'next/server';

function jsonReq(method: string, body: unknown, url = 'http://localhost/api/tastes'): NextRequest {
  return new NextRequest(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const authedUser = { id: 'u1', plan: 'pro' };

beforeEach(() => {
  jest.clearAllMocks();
  mockGetUserFromRequest.mockResolvedValue(authedUser);
  mockCountTastes.mockResolvedValue(0);
});

describe('POST /api/tastes — taster attribution', () => {
  it('passes a body taster_id through to createTaste', async () => {
    mockCreateTaste.mockResolvedValue({ id: 't1', status: 'tasted', verdict: 'yum', tasterId: 'ts_partner' });
    const res = await POST(jsonReq('POST', { name: 'For Partner', verdict: 'yum', tasterId: 'ts_partner' }));
    expect(res.status).toBe(201);
    expect(mockCreateTaste).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({ tasterId: 'ts_partner' }),
    );
  });

  it('does not invent a taster when none is sent (DB layer applies the self default)', async () => {
    mockCreateTaste.mockResolvedValue({ id: 't2', status: 'tasted', verdict: 'meh' });
    await POST(jsonReq('POST', { name: 'No Taster', verdict: 'meh' }));
    expect(mockCreateTaste).toHaveBeenCalledTimes(1);
    const input = mockCreateTaste.mock.calls[0][1] as { tasterId?: string };
    expect(input.tasterId).toBeUndefined();
  });

  it('returns 400 invalid_taster when createTaste rejects a foreign taster (IDOR)', async () => {
    // The DB helper throws CreateTasteError for a taster the caller does not own;
    // the route must translate that into a 400, NOT a 500 (and never a 201).
    mockCreateTaste.mockRejectedValue(new CreateTasteError('invalid_taster'));
    const res = await POST(jsonReq('POST', { name: 'Poison', verdict: 'yum', tasterId: 'ts_foreign' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_taster' });
  });
});

describe('GET /api/tastes — taster filter', () => {
  it('forwards ?taster=<id> to listTastes', async () => {
    mockListTastes.mockResolvedValue([]);
    await GET(new NextRequest('http://localhost/api/tastes?taster=ts_partner'));
    expect(mockListTastes).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({ taster: 'ts_partner' }),
    );
  });

  it('forwards no taster filter when ?taster is absent', async () => {
    mockListTastes.mockResolvedValue([]);
    await GET(new NextRequest('http://localhost/api/tastes'));
    const opts = mockListTastes.mock.calls[0][1] as { taster?: string };
    expect(opts.taster).toBeUndefined();
  });
});
