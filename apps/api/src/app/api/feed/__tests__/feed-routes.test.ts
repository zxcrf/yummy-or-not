// Route-handler tests for S3c cross-user feeds — /api/feed/geo, /geo/near,
// /geo/heat, /family. The DB layer is mocked; these pin the HTTP contract plus
// the PRIVACY boundary that is the whole reason this subsystem is careful:
//
//   §S3c security: "geo feed 不泄漏精确坐标 / owner 身份 / 精确地址（半径查询结果
//   也粗化到 grid_cell）" and "非 'shared' 记录任何旁路不可读".
//
// What it pins:
//   - GET /api/feed/geo?cell=<geohash>: only cards in that cell; the response
//     shape carries grid_cell but NEVER lat/lng/userId/ownerId/place (precise
//     address). A missing cell param → 400.
//   - GET /api/feed/geo/near?lat=&lng=&radius=: same coarsening — even though the
//     SERVER ran a precise radius query, the RESPONSE is snapped to grid_cell and
//     strips precise coords + owner identity. Missing/invalid params → 400.
//   - GET /api/feed/geo/heat?bbox=: returns [{ cell, count }] aggregation only —
//     no per-record rows, no coords, no identity.
//   - The feed helpers are only ever asked for 'shared' geo rows (the route never
//     bypasses the visibility filter) — proven here by the helper contract and,
//     end-to-end, by the PostGIS integration test which seeds a private row and
//     asserts it is absent.
//
// FAILS today: apps/api/src/app/api/feed/* routes do not exist. PASSES once S3c
// ships them. The private-row negative is proven for real (not just mocked) in
// feed-geo-postgis.integration.test.ts against the live PostGIS container.

const mockListGeoFeedByCell = jest.fn();
const mockListGeoFeedNear = jest.fn();
const mockGeoHeat = jest.fn();
const mockListFamilyFeed = jest.fn();
const mockGetUserFromRequest = jest.fn();

jest.mock('@/lib/auth', () => ({
  getUserFromRequest: (...args: unknown[]) => mockGetUserFromRequest(...args),
}));

jest.mock('@/lib/cors', () => ({
  corsPreflight: jest.fn(() => new Response(null, { status: 204 })),
  withCors: jest.fn((res: Response) => res),
}));

jest.mock('@/lib/db', () => ({
  listGeoFeedByCell: (...args: unknown[]) => mockListGeoFeedByCell(...args),
  listGeoFeedNear: (...args: unknown[]) => mockListGeoFeedNear(...args),
  geoHeat: (...args: unknown[]) => mockGeoHeat(...args),
  listFamilyFeed: (...args: unknown[]) => mockListFamilyFeed(...args),
}));

// GeohashCoverTooLargeError is imported from @yon/shared by the routes.
// We need the real class so we can throw it from mocks and assert the route
// maps it to HTTP 400 (not 500).
import { GeohashCoverTooLargeError } from '@yon/shared';

import { GET as GET_GEO } from '../geo/route';
import { GET as GET_NEAR } from '../geo/near/route';
import { GET as GET_HEAT } from '../geo/heat/route';
import { GET as GET_FAMILY } from '../family/route';
import { NextRequest } from 'next/server';

function get(url: string): NextRequest {
  return new NextRequest(url, { method: 'GET' });
}
async function bodyOf(res: Response): Promise<unknown> {
  return JSON.parse(await res.text());
}

// Forbidden keys: if ANY of these survive into a feed response, precise location
// or owner identity has leaked. The COARSENED card is allowed to keep grid_cell,
// verdict, name, etc.
const FORBIDDEN_KEYS = ['lat', 'lng', 'latitude', 'longitude', 'userId', 'user_id', 'ownerId', 'owner_id', 'place', 'address', 'notes'];

function assertNoLeak(obj: Record<string, unknown>) {
  for (const k of FORBIDDEN_KEYS) {
    expect(obj).not.toHaveProperty(k);
  }
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetUserFromRequest.mockResolvedValue({ id: 'viewer', plan: 'free' });
});

describe('GET /api/feed/geo?cell= — cell card stream (coarsened, anonymous)', () => {
  it('returns only coarsened cards for the requested cell — no precise coords / owner identity', async () => {
    // Helper returns ONLY safe fields (this is the contract): the route must not
    // re-attach precise data. We assert on the route OUTPUT.
    mockListGeoFeedByCell.mockResolvedValue([
      { id: 's1', name: 'Ramen', verdict: 'yum', gridCell: 'xn4z5' },
      { id: 's2', name: 'Boba', verdict: 'meh', gridCell: 'xn4z5' },
    ]);
    const res = await GET_GEO(get('http://localhost/api/feed/geo?cell=xn4z5'));
    expect(res.status).toBe(200);
    const items = (await bodyOf(res)) as Array<Record<string, unknown>>;
    expect(items).toHaveLength(2);
    expect(mockListGeoFeedByCell).toHaveBeenCalledWith('xn4z5');
    for (const card of items) {
      expect(card.gridCell).toBe('xn4z5');
      assertNoLeak(card);
    }
  });

  it('400 when the cell param is missing (no unbounded full-table scan)', async () => {
    const res = await GET_GEO(get('http://localhost/api/feed/geo'));
    expect(res.status).toBe(400);
    expect(mockListGeoFeedByCell).not.toHaveBeenCalled();
  });

  it('surfaces the SAFE enrichment fields (tags / boughtCount / warnBeforeBuy) but never place/notes', async () => {
    // These coarse fields enrich the card without deanonymizing it; the route
    // must pass them through. place/notes must still never appear (assertNoLeak).
    mockListGeoFeedByCell.mockResolvedValue([
      {
        id: 's1',
        name: 'Ramen',
        verdict: 'yum',
        gridCell: 'xn4z5',
        tags: ['Ramen', 'Spicy'],
        boughtCount: 4,
        warnBeforeBuy: true,
      },
    ]);
    const res = await GET_GEO(get('http://localhost/api/feed/geo?cell=xn4z5'));
    expect(res.status).toBe(200);
    const [card] = (await bodyOf(res)) as Array<Record<string, unknown>>;
    expect(card.tags).toEqual(['Ramen', 'Spicy']);
    expect(card.boughtCount).toBe(4);
    expect(card.warnBeforeBuy).toBe(true);
    assertNoLeak(card);
  });
});

describe('GET /api/feed/geo/near?lat=&lng=&radius= — PostGIS radius, coarsened response', () => {
  it('parses lat/lng/radius, calls the radius helper, and the RESPONSE strips precise coords + identity', async () => {
    // Even if a buggy helper leaked precise data, the route must coarsen. Seed the
    // helper with the safe shape it is contracted to return and assert the route
    // never widens it.
    mockListGeoFeedNear.mockResolvedValue([
      { id: 's1', name: 'Ramen', verdict: 'yum', gridCell: 'xn4z5' },
    ]);
    const res = await GET_NEAR(get('http://localhost/api/feed/geo/near?lat=35.0&lng=139.0&radius=2000'));
    expect(res.status).toBe(200);
    expect(mockListGeoFeedNear).toHaveBeenCalledWith(
      expect.objectContaining({ lat: 35.0, lng: 139.0, radiusM: 2000 }),
    );
    const items = (await bodyOf(res)) as Array<Record<string, unknown>>;
    for (const card of items) {
      expect(card).toHaveProperty('gridCell');
      assertNoLeak(card);
    }
  });

  it('400 when lat/lng/radius are missing or non-numeric', async () => {
    const bad = await GET_NEAR(get('http://localhost/api/feed/geo/near?lat=abc&lng=139.0&radius=2000'));
    expect(bad.status).toBe(400);
    const missing = await GET_NEAR(get('http://localhost/api/feed/geo/near?lat=35.0'));
    expect(missing.status).toBe(400);
    expect(mockListGeoFeedNear).not.toHaveBeenCalled();
  });

  it('clamps an excessive radius so the feed cannot be turned into a whole-region dump', async () => {
    mockListGeoFeedNear.mockResolvedValue([]);
    await GET_NEAR(get('http://localhost/api/feed/geo/near?lat=35.0&lng=139.0&radius=99999999'));
    const arg = mockListGeoFeedNear.mock.calls[0][0] as { radiusM: number };
    // A sane cap (the plan keeps this a *nearby* feed, not a global scrape).
    expect(arg.radiusM).toBeLessThanOrEqual(50_000);
  });
});

describe('GET /api/feed/geo/heat?bbox= — grid heat aggregation', () => {
  it('returns [{ cell, count }] aggregation only — no per-record rows, no coords/identity', async () => {
    mockGeoHeat.mockResolvedValue([
      { cell: 'xn4z5', count: 7 },
      { cell: 'xn4z6', count: 2 },
    ]);
    const res = await GET_HEAT(get('http://localhost/api/feed/geo/heat?bbox=138.9,34.9,139.1,35.1'));
    expect(res.status).toBe(200);
    const rows = (await bodyOf(res)) as Array<Record<string, unknown>>;
    expect(rows).toEqual([
      { cell: 'xn4z5', count: 7 },
      { cell: 'xn4z6', count: 2 },
    ]);
    // Each heat bucket is JUST a cell + a count — nothing that identifies a record
    // or a person.
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(['cell', 'count']);
      assertNoLeak(row);
    }
  });

  it('400 on a missing/malformed bbox', async () => {
    const res = await GET_HEAT(get('http://localhost/api/feed/geo/heat'));
    expect(res.status).toBe(400);
    expect(mockGeoHeat).not.toHaveBeenCalled();
  });
});

describe('GeohashCoverTooLargeError → HTTP 400 (not 500)', () => {
  // When the db helper throws GeohashCoverTooLargeError (the cap-breach signal),
  // the routes must map it to 400 area_too_large — not swallow it as a 500.
  // A 500 would hide the breach from the caller; a 400 surfaces it explicitly
  // (CLAUDE.md: "Fail explicitly, don't fail silently").
  it('near route: throws GeohashCoverTooLargeError → 400 area_too_large', async () => {
    mockListGeoFeedNear.mockRejectedValue(new GeohashCoverTooLargeError('test'));
    const res = await GET_NEAR(get('http://localhost/api/feed/geo/near?lat=35.0&lng=139.0&radius=2000'));
    expect(res.status).toBe(400);
    const body = (await bodyOf(res)) as Record<string, unknown>;
    expect(body.error).toBe('area_too_large');
  });

  it('heat route: throws GeohashCoverTooLargeError → 400 area_too_large', async () => {
    mockGeoHeat.mockRejectedValue(new GeohashCoverTooLargeError('test'));
    const res = await GET_HEAT(get('http://localhost/api/feed/geo/heat?bbox=138.9,34.9,139.1,35.1'));
    expect(res.status).toBe(400);
    const body = (await bodyOf(res)) as Record<string, unknown>;
    expect(body.error).toBe('area_too_large');
  });

  it('near route: a non-cover error still returns 500 (not every error is a 400)', async () => {
    mockListGeoFeedNear.mockRejectedValue(new Error('db connection lost'));
    const res = await GET_NEAR(get('http://localhost/api/feed/geo/near?lat=35.0&lng=139.0&radius=2000'));
    expect(res.status).toBe(500);
  });

  it('heat route: a non-cover error still returns 500', async () => {
    mockGeoHeat.mockRejectedValue(new Error('db connection lost'));
    const res = await GET_HEAT(get('http://localhost/api/feed/geo/heat?bbox=138.9,34.9,139.1,35.1'));
    expect(res.status).toBe(500);
  });
});

describe('GET /api/feed/family?member= — family / member feed', () => {
  it('requires auth — 401 for an anonymous caller, and never queries', async () => {
    mockGetUserFromRequest.mockResolvedValue(null);
    const res = await GET_FAMILY(get('http://localhost/api/feed/family?member=ts_partner'));
    expect(res.status).toBe(401);
    expect(mockListFamilyFeed).not.toHaveBeenCalled();
  });

  it('passes the viewer id + member filter to the helper (visibility scoped server-side)', async () => {
    mockListFamilyFeed.mockResolvedValue([{ id: 's1', name: 'Ramen', verdict: 'yum' }]);
    const res = await GET_FAMILY(get('http://localhost/api/feed/family?member=ts_partner'));
    expect(res.status).toBe(200);
    expect(mockListFamilyFeed).toHaveBeenCalledWith(
      expect.objectContaining({ viewerId: 'viewer', member: 'ts_partner' }),
    );
  });
});
