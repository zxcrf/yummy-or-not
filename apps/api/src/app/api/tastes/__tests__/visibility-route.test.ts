// Route-handler tests for S3c targeted-publish — PATCH /api/tastes/:id/visibility.
// The DB layer is mocked; these pin the HTTP contract plus the load-bearing
// SERVER-SIDE boundaries (never trust the client):
//
//   - OWNERSHIP: a caller who does not own the taste gets 404 (not found —
//     don't leak existence) and NO share is written. This is the IDOR guard.
//   - AUTH: an unauthenticated caller gets 401 and never reaches the DB.
//   - geo publish DOUBLE-WRITES geog + grid_cell: the route must compute a
//     grid_cell (geohash of the taste's coords) and pass BOTH to the share
//     writer — never store a precise location without its coarsened cell.
//   - publishing flips tastes.visibility to 'shared'.
//   - a geo target on a taste with NO coordinates is rejected (422) — you can't
//     publish to "nearby" what has no location, and we must not write a null geog.
//   - family/member targets are gated to plan='pro' server-side (pro≡family per
//     the plan); a free user gets 403 pro_required and nothing is written.
//
// FAILS today: apps/api/src/app/api/tastes/[id]/visibility/route.ts does not
// exist. PASSES once S3c ships the route with ownership + gating + double-write.
//
// The DB helpers (getTaste / setTasteVisibility) are mocked so this isolates the
// route control flow; the real coarsening + ST_DWithin behaviour is covered by
// the PostGIS integration test (feed-geo-postgis.integration.test.ts).

const mockGetUserFromRequest = jest.fn();
const mockGetTaste = jest.fn();
const mockSetTasteVisibility = jest.fn();
const mockFindUnownedShareTargets = jest.fn();

jest.mock('@/lib/auth', () => ({
  getUserFromRequest: (...args: unknown[]) => mockGetUserFromRequest(...args),
}));

jest.mock('@/lib/cors', () => ({
  corsPreflight: jest.fn(() => new Response(null, { status: 204 })),
  withCors: jest.fn((res: Response) => res),
}));

jest.mock('@/lib/db', () => ({
  getTaste: (...args: unknown[]) => mockGetTaste(...args),
  // Writes taste_shares rows + flips tastes.visibility; returns the updated taste.
  setTasteVisibility: (...args: unknown[]) => mockSetTasteVisibility(...args),
  // Returns the subset of family/member target_ids the caller does NOT own.
  findUnownedShareTargets: (...args: unknown[]) => mockFindUnownedShareTargets(...args),
}));

import { PATCH } from '../[id]/visibility/route';
import { NextRequest } from 'next/server';

function patchReq(id: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost/api/tastes/${id}/visibility`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function bodyOf(res: Response): Promise<Record<string, unknown>> {
  return JSON.parse(await res.text());
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

const freeUser = { id: 'u1', plan: 'free' };
const proUser = { id: 'u1', plan: 'pro' };
// A taste owned by u1 with real coordinates (Tokyo-ish), used for geo publish.
const ownedTaste = { id: 't1', userId: 'u1', lat: 35.0, lng: 139.0, visibility: 'private' };

beforeEach(() => {
  jest.clearAllMocks();
  mockGetUserFromRequest.mockResolvedValue(freeUser);
  mockGetTaste.mockResolvedValue(ownedTaste);
  // Default: every family/member target_id is owned by the caller (none unowned).
  mockFindUnownedShareTargets.mockResolvedValue([]);
  mockSetTasteVisibility.mockImplementation(async (_uid, _id, _targets) => ({
    ...ownedTaste,
    visibility: 'shared',
  }));
});

describe('PATCH /api/tastes/:id/visibility — auth + ownership (IDOR guard)', () => {
  it('rejects an unauthenticated caller with 401 and never reaches the DB', async () => {
    mockGetUserFromRequest.mockResolvedValue(null);
    const res = await PATCH(patchReq('t1', { targets: [{ type: 'geo' }] }), ctx('t1'));
    expect(res.status).toBe(401);
    expect(mockGetTaste).not.toHaveBeenCalled();
    expect(mockSetTasteVisibility).not.toHaveBeenCalled();
  });

  it('returns 404 when the caller does not own the taste, and writes nothing', async () => {
    // getTaste is scoped to the caller; a foreign taste reads back as null.
    mockGetTaste.mockResolvedValue(null);
    const res = await PATCH(patchReq('t_other', { targets: [{ type: 'geo' }] }), ctx('t_other'));
    expect(res.status).toBe(404);
    expect(mockSetTasteVisibility).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/tastes/:id/visibility — geo publish double-write', () => {
  it('computes a grid_cell from the taste coords and passes BOTH geog source + grid_cell to the writer', async () => {
    const res = await PATCH(patchReq('t1', { targets: [{ type: 'geo' }] }), ctx('t1'));
    expect(res.status).toBe(200);
    expect(mockSetTasteVisibility).toHaveBeenCalledTimes(1);

    const [uid, tasteId, targets] = mockSetTasteVisibility.mock.calls[0];
    expect(uid).toBe('u1');
    expect(tasteId).toBe('t1');
    // The geo target handed to the writer must carry BOTH the coarsened grid_cell
    // and the lat/lng for the geography point — the double-write the plan requires.
    const geo = (targets as Array<Record<string, unknown>>).find((t) => t.type === 'geo')!;
    expect(geo).toBeDefined();
    // grid_cell is the precision-5 geohash of (35.0, 139.0) → "xn4z5".
    expect(geo.gridCell).toBe('xn4z5');
    expect(geo.lat).toBe(35.0);
    expect(geo.lng).toBe(139.0);
  });

  it("flips the taste's visibility to 'shared' on a successful publish", async () => {
    const res = await PATCH(patchReq('t1', { targets: [{ type: 'geo' }] }), ctx('t1'));
    expect(res.status).toBe(200);
    expect((await bodyOf(res)).visibility).toBe('shared');
  });

  it('rejects a geo publish on a taste with no coordinates (422) and writes nothing', async () => {
    mockGetTaste.mockResolvedValue({ id: 't1', userId: 'u1', lat: null, lng: null, visibility: 'private' });
    const res = await PATCH(patchReq('t1', { targets: [{ type: 'geo' }] }), ctx('t1'));
    expect(res.status).toBe(422);
    expect(mockSetTasteVisibility).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/tastes/:id/visibility — server-side pro gate (family/member)', () => {
  it('rejects a FREE user publishing to family with 403 pro_required and writes nothing', async () => {
    mockGetUserFromRequest.mockResolvedValue(freeUser);
    const res = await PATCH(
      patchReq('t1', { targets: [{ type: 'family', target_id: 'fam1' }] }),
      ctx('t1'),
    );
    expect(res.status).toBe(403);
    expect((await bodyOf(res)).error).toBe('pro_required');
    expect(mockSetTasteVisibility).not.toHaveBeenCalled();
  });

  it('rejects a FREE user publishing to a specific member with 403 pro_required', async () => {
    mockGetUserFromRequest.mockResolvedValue(freeUser);
    const res = await PATCH(
      patchReq('t1', { targets: [{ type: 'member', target_id: 'ts_partner' }] }),
      ctx('t1'),
    );
    expect(res.status).toBe(403);
    expect((await bodyOf(res)).error).toBe('pro_required');
    expect(mockSetTasteVisibility).not.toHaveBeenCalled();
  });

  it('lets a PRO user publish to family → 200', async () => {
    mockGetUserFromRequest.mockResolvedValue(proUser);
    const res = await PATCH(
      patchReq('t1', { targets: [{ type: 'family', target_id: 'fam1' }] }),
      ctx('t1'),
    );
    expect(res.status).toBe(200);
    expect(mockSetTasteVisibility).toHaveBeenCalledTimes(1);
  });

  it('allows a FREE user to publish to geo (nearby is not pro-gated, only family/member are)', async () => {
    mockGetUserFromRequest.mockResolvedValue(freeUser);
    const res = await PATCH(patchReq('t1', { targets: [{ type: 'geo' }] }), ctx('t1'));
    expect(res.status).toBe(200);
    expect(mockSetTasteVisibility).toHaveBeenCalledTimes(1);
  });
});

describe('PATCH /api/tastes/:id/visibility — target ownership (record-poisoning guard)', () => {
  // A pro user must NOT be able to publish to an arbitrary target_id. The route
  // validates family/member target_ids against the caller's own tasters/families
  // via findUnownedShareTargets; any unowned id → 422, nothing written.
  it('rejects a PRO user publishing to a foreign target_id with 422 and writes nothing', async () => {
    mockGetUserFromRequest.mockResolvedValue(proUser);
    // The validator reports the target as unowned (belongs to another account).
    mockFindUnownedShareTargets.mockResolvedValue(['ts_someone_elses']);
    const res = await PATCH(
      patchReq('t1', { targets: [{ type: 'member', target_id: 'ts_someone_elses' }] }),
      ctx('t1'),
    );
    expect(res.status).toBe(422);
    expect((await bodyOf(res)).error).toBe('invalid_target');
    // The validator was asked about the exact target id the caller sent.
    expect(mockFindUnownedShareTargets).toHaveBeenCalledWith('u1', ['ts_someone_elses']);
    expect(mockSetTasteVisibility).not.toHaveBeenCalled();
  });

  it('rejects a family/member target with a missing target_id (422, never queries ownership)', async () => {
    mockGetUserFromRequest.mockResolvedValue(proUser);
    const res = await PATCH(patchReq('t1', { targets: [{ type: 'member' }] }), ctx('t1'));
    expect(res.status).toBe(422);
    expect((await bodyOf(res)).error).toBe('invalid_target');
    expect(mockSetTasteVisibility).not.toHaveBeenCalled();
  });

  it('lets a PRO user publish to their OWN member target → 200 (validator finds nothing unowned)', async () => {
    mockGetUserFromRequest.mockResolvedValue(proUser);
    mockFindUnownedShareTargets.mockResolvedValue([]);
    const res = await PATCH(
      patchReq('t1', { targets: [{ type: 'member', target_id: 'ts_mine' }] }),
      ctx('t1'),
    );
    expect(res.status).toBe(200);
    expect(mockFindUnownedShareTargets).toHaveBeenCalledWith('u1', ['ts_mine']);
    expect(mockSetTasteVisibility).toHaveBeenCalledTimes(1);
  });
});
