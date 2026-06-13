// Route-handler tests for S3b taster-persona CRUD — /api/tasters. The DB layer
// is mocked; these pin the HTTP contract and the SERVER-SIDE plan gate (the
// design's load-bearing security boundary — never trust the client):
//
//   - GET  always returns the caller's tasters (free user still sees self).
//   - POST by a FREE user → 403 pro_required, and createTaster is NEVER called
//     (the gate runs before any write — free users can only have a self-taster).
//   - POST by a PRO user → 201 with the created taster.
//   - PATCH by a FREE user → 403 pro_required (gate covers edits too).
//   - DELETE of a self-taster → 409 self_taster_protected, deleteTaster NOT called
//     (is_self protection; the owner's default persona is undeletable).
//   - DELETE of a non-self taster by a PRO user → 200 ok.
//
// These FAIL today: apps/api/src/app/api/tasters/route.ts does not exist yet.
// They PASS once S3b ships the route with the server-side plan gate + self
// protection. The DB helpers (listTasters/createTaster/updateTaster/
// getTaster/deleteTaster) are mocked so this isolates the route control flow;
// the real DB behaviour (backfill, is_self) is covered in tasters-backfill.test.ts.

const mockGetUserFromRequest = jest.fn();
const mockListTasters = jest.fn();
const mockCreateTaster = jest.fn();
const mockUpdateTaster = jest.fn();
const mockGetTaster = jest.fn();
const mockDeleteTaster = jest.fn();

jest.mock('@/lib/auth', () => ({
  getUserFromRequest: (...args: unknown[]) => mockGetUserFromRequest(...args),
}));

jest.mock('@/lib/cors', () => ({
  corsPreflight: jest.fn(() => new Response(null, { status: 204 })),
  withCors: jest.fn((res: Response) => res),
}));

jest.mock('@/lib/db', () => ({
  listTasters: (...args: unknown[]) => mockListTasters(...args),
  createTaster: (...args: unknown[]) => mockCreateTaster(...args),
  updateTaster: (...args: unknown[]) => mockUpdateTaster(...args),
  getTaster: (...args: unknown[]) => mockGetTaster(...args),
  deleteTaster: (...args: unknown[]) => mockDeleteTaster(...args),
}));

import { GET, POST } from '../route';
import { PATCH, DELETE } from '../[id]/route';
import { NextRequest } from 'next/server';

function jsonReq(method: string, body: unknown, url = 'http://localhost/api/tasters'): NextRequest {
  return new NextRequest(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function bodyOf(res: Response): Promise<Record<string, unknown>> {
  return JSON.parse(await res.text());
}

const freeUser = { id: 'u1', plan: 'free' };
const proUser = { id: 'u1', plan: 'pro' };

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  jest.clearAllMocks();
  mockGetUserFromRequest.mockResolvedValue(freeUser);
});

describe('GET /api/tasters', () => {
  it('returns the caller tasters even on the free plan (self-taster visible)', async () => {
    mockListTasters.mockResolvedValue([
      { id: 'ts_self', displayName: 'Me', isSelf: true },
    ]);
    const res = await GET(new NextRequest('http://localhost/api/tasters'));
    expect(res.status).toBe(200);
    const body = (await bodyOf(res)) as unknown as Array<{ isSelf: boolean }>;
    expect(body).toHaveLength(1);
    expect(body[0].isSelf).toBe(true);
    expect(mockListTasters).toHaveBeenCalledWith('u1');
  });
});

describe('POST /api/tasters — server-side pro gate', () => {
  it('rejects a FREE user with 403 pro_required and never writes', async () => {
    mockGetUserFromRequest.mockResolvedValue(freeUser);
    const res = await POST(jsonReq('POST', { displayName: 'Partner' }));
    expect(res.status).toBe(403);
    expect((await bodyOf(res)).error).toBe('pro_required');
    // The gate must run BEFORE any DB write — a free user can only own a self-taster.
    expect(mockCreateTaster).not.toHaveBeenCalled();
  });

  it('lets a PRO user create a taster → 201', async () => {
    mockGetUserFromRequest.mockResolvedValue(proUser);
    mockCreateTaster.mockResolvedValue({
      id: 'ts_new', displayName: 'Partner', isSelf: false,
    });
    const res = await POST(jsonReq('POST', { displayName: 'Partner' }));
    expect(res.status).toBe(201);
    const body = await bodyOf(res);
    expect(body.id).toBe('ts_new');
    expect(body.isSelf).toBe(false);
    expect(mockCreateTaster).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({ displayName: 'Partner' }),
    );
  });
});

describe('PATCH /api/tasters/:id — server-side pro gate', () => {
  it('rejects a FREE user editing a taster with 403 pro_required and never writes', async () => {
    mockGetUserFromRequest.mockResolvedValue(freeUser);
    const res = await PATCH(
      jsonReq('PATCH', { displayName: 'Renamed' }, 'http://localhost/api/tasters/ts_x'),
      ctx('ts_x'),
    );
    expect(res.status).toBe(403);
    expect((await bodyOf(res)).error).toBe('pro_required');
    expect(mockUpdateTaster).not.toHaveBeenCalled();
  });

  it('lets a PRO user rename a taster → 200', async () => {
    mockGetUserFromRequest.mockResolvedValue(proUser);
    mockUpdateTaster.mockResolvedValue({ id: 'ts_x', displayName: 'Renamed', isSelf: false });
    const res = await PATCH(
      jsonReq('PATCH', { displayName: 'Renamed' }, 'http://localhost/api/tasters/ts_x'),
      ctx('ts_x'),
    );
    expect(res.status).toBe(200);
    expect((await bodyOf(res)).displayName).toBe('Renamed');
  });
});

describe('DELETE /api/tasters/:id — self-taster protection + pro gate', () => {
  it('refuses to delete the self-taster with 409 self_taster_protected (even for pro)', async () => {
    mockGetUserFromRequest.mockResolvedValue(proUser);
    // The targeted row is the owner's is_self persona.
    mockGetTaster.mockResolvedValue({ id: 'ts_self', isSelf: true });
    const res = await DELETE(
      jsonReq('DELETE', undefined, 'http://localhost/api/tasters/ts_self'),
      ctx('ts_self'),
    );
    expect(res.status).toBe(409);
    expect((await bodyOf(res)).error).toBe('self_taster_protected');
    // The undeletable self-taster must never reach the delete helper.
    expect(mockDeleteTaster).not.toHaveBeenCalled();
  });

  it('rejects a FREE user deleting any taster with 403 pro_required', async () => {
    mockGetUserFromRequest.mockResolvedValue(freeUser);
    mockGetTaster.mockResolvedValue({ id: 'ts_x', isSelf: false });
    const res = await DELETE(
      jsonReq('DELETE', undefined, 'http://localhost/api/tasters/ts_x'),
      ctx('ts_x'),
    );
    expect(res.status).toBe(403);
    expect((await bodyOf(res)).error).toBe('pro_required');
    expect(mockDeleteTaster).not.toHaveBeenCalled();
  });

  it('lets a PRO user delete a non-self taster → 200 ok', async () => {
    mockGetUserFromRequest.mockResolvedValue(proUser);
    mockGetTaster.mockResolvedValue({ id: 'ts_x', isSelf: false });
    mockDeleteTaster.mockResolvedValue(true);
    const res = await DELETE(
      jsonReq('DELETE', undefined, 'http://localhost/api/tasters/ts_x'),
      ctx('ts_x'),
    );
    expect(res.status).toBe(200);
    expect((await bodyOf(res)).ok).toBe(true);
    expect(mockDeleteTaster).toHaveBeenCalledWith('u1', 'ts_x');
  });
});
