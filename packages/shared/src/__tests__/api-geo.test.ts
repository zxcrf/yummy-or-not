// RED tests (S3c geo feeds) for NEW api-client.ts functions getGeoHeat /
// getGeoFeedByCell. They FAIL now (functions not implemented) and PASS once the
// impl adds them. The backend is ALREADY LIVE and MUST NOT change — these pin
// the exact query strings + error surfacing the client depends on:
//
//   getGeoHeat(box)        → GET /api/feed/geo/heat?bbox=minLng,minLat,maxLng,maxLat → [{cell,count}]
//   getGeoFeedByCell(cell) → GET /api/feed/geo?cell=<geohash5>                       → GeoFeedCard[]
//
// apiFetch throws new Error(serverErrorCode) on non-2xx, so:
//   400 {error:'area_too_large'} → rejects Error('area_too_large')
//   400 {error:'cell_required'}  → rejects Error('cell_required')

import { getGeoHeat, getGeoFeedByCell } from '../api-client';

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
});

describe('getGeoHeat', () => {
  it('GETs /api/feed/geo/heat with bbox=minLng,minLat,maxLng,maxLat (exact order) and returns [{cell,count}]', async () => {
    mockJson(200, [
      { cell: 'wtw3s', count: 7 },
      { cell: 'wtw3t', count: 3 },
    ]);

    const out = await getGeoHeat({ minLng: 121.0, minLat: 31.0, maxLng: 121.5, maxLat: 31.4 });

    // Exact path + query-string component order: bbox=minLng,minLat,maxLng,maxLat.
    expect(lastFetch?.url).toContain('/api/feed/geo/heat?bbox=121,31,121.5,31.4');
    expect((lastFetch?.init?.method ?? 'GET')).toBe('GET');

    expect(out).toEqual([
      { cell: 'wtw3s', count: 7 },
      { cell: 'wtw3t', count: 3 },
    ]);
  });

  it('rejects with Error("area_too_large") on a 400 {error:"area_too_large"}', async () => {
    mockJson(400, { error: 'area_too_large' });
    await expect(
      getGeoHeat({ minLng: 0, minLat: 0, maxLng: 90, maxLat: 90 }),
    ).rejects.toThrow('area_too_large');
  });
});

describe('getGeoFeedByCell', () => {
  it('GETs /api/feed/geo?cell=<cell> and returns the GeoFeedCard[]', async () => {
    const card = {
      id: 't1',
      name: 'Boba',
      verdict: 'yum',
      image: 'https://r2/full.jpg',
      imageThumb: 'https://r2/thumb.jpg',
      imageDisplay: 'https://r2/display.jpg',
      gridCell: 'wtw3s',
      // Safe enrichment fields (bounded category / counter / flag — no PII).
      tags: ['Boba', 'Sweet'],
      boughtCount: 3,
      warnBeforeBuy: false,
    };
    mockJson(200, [card]);

    const out = await getGeoFeedByCell('wtw3s');
    expect(lastFetch?.url).toContain('/api/feed/geo?cell=wtw3s');
    expect((lastFetch?.init?.method ?? 'GET')).toBe('GET');
    expect(out).toEqual([card]);
  });

  it('rejects with Error("cell_required") on a 400 {error:"cell_required"}', async () => {
    mockJson(400, { error: 'cell_required' });
    await expect(getGeoFeedByCell('')).rejects.toThrow('cell_required');
  });
});
