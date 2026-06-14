// RED tests (S3c "附近·热力" AMap heat layer) for NEW pure functions to be added
// to packages/shared/src/geo.ts. These FAIL now (functions don't exist yet) and
// PASS once the impl adds them. They PIN the privacy + amap-drift contract:
//
//   geohashCellCenterGcj02(cell)  → cell center, WGS84→GCJ-02 shifted (China).
//   geohashCellRectGcj02(cell)    → 4 GCJ-02 corners for an amap Polygon.
//   estimateBboxCellCount(box,p)  → analytic precision-5 cell count (cheap, no enumeration).
//   isBboxHeatQueryable(box,p)    → estimate <= GEOHASH_COVER_CAP (zoom-cap gate).
//
// WHY these matter:
//  - GCJ-02 shift: if the impl feeds raw WGS84 cell centers to AMap the whole
//    layer drifts ~hundreds of metres in China. The center test asserts the
//    GCJ-02 center is offset 100..1000 m from the raw WGS84 decoded midpoint.
//  - zoom-cap: a viewport that would exceed GEOHASH_COVER_CAP must be refused
//    BEFORE fetching (server would 400 area_too_large). estimate/queryable are
//    the cheap client-side gate; they must agree with the server's cap.

import {
  encodeGeohash,
  decodeGeohashBounds,
  haversineMeters,
  wgs84ToGcj02,
  gcj02ToWgs84,
  GEOHASH_COVER_CAP,
  GeohashCoverTooLargeError,
  geohashCellsInBbox,
  geohashCellCenterGcj02,
  geohashCellRectGcj02,
  estimateBboxCellCount,
  isBboxHeatQueryable,
} from '../geo';

// precision-5 angular cell size (12 lat bits, 13 lng bits) ≈ 0.0439°.
const LAT_STEP = 180 / 2 ** 12;
const LNG_STEP = 360 / 2 ** 13;

// A real China cell (Shanghai People's Square).
const SHANGHAI_CELL = encodeGeohash(31.23, 121.47, 5);

describe('geohashCellCenterGcj02', () => {
  it('returns the cell center shifted WGS84→GCJ-02 (China offset 100..1000 m from the raw decoded midpoint)', () => {
    const b = decodeGeohashBounds(SHANGHAI_CELL);
    const wgsLat = (b.minLat + b.maxLat) / 2;
    const wgsLng = (b.minLng + b.maxLng) / 2;

    const center = geohashCellCenterGcj02(SHANGHAI_CELL);
    expect(Number.isFinite(center.lat)).toBe(true);
    expect(Number.isFinite(center.lng)).toBe(true);

    // It must equal the GCJ-02 of the raw WGS84 midpoint (so the impl can't
    // accidentally return the raw midpoint and pass).
    const expected = wgs84ToGcj02(wgsLat, wgsLng);
    expect(center.lat).toBeCloseTo(expected.lat, 6);
    expect(center.lng).toBeCloseTo(expected.lng, 6);

    // And the shift magnitude is in the GCJ-02-in-China band.
    const drift = haversineMeters(wgsLat, wgsLng, center.lat, center.lng);
    expect(drift).toBeGreaterThan(100);
    expect(drift).toBeLessThan(1000);
  });
});

describe('geohashCellRectGcj02', () => {
  it('returns 4 finite GCJ-02 corners ({latitude,longitude}) that bound the GCJ-02 center', () => {
    const rect = geohashCellRectGcj02(SHANGHAI_CELL);
    expect(rect).toHaveLength(4);

    for (const corner of rect) {
      expect(Number.isFinite(corner.latitude)).toBe(true);
      expect(Number.isFinite(corner.longitude)).toBe(true);
    }

    const center = geohashCellCenterGcj02(SHANGHAI_CELL);
    const lats = rect.map((c) => c.latitude);
    const lngs = rect.map((c) => c.longitude);
    // The center lies strictly inside the corner-bounding box.
    expect(Math.min(...lats)).toBeLessThan(center.lat);
    expect(Math.max(...lats)).toBeGreaterThan(center.lat);
    expect(Math.min(...lngs)).toBeLessThan(center.lng);
    expect(Math.max(...lngs)).toBeGreaterThan(center.lng);
  });
});

describe('estimateBboxCellCount', () => {
  it('a tiny ~1-cell bbox → a small count', () => {
    const box = { minLat: 31.0, maxLat: 31.0 + LAT_STEP * 0.5, minLng: 121.0, maxLng: 121.0 + LNG_STEP * 0.5 };
    const n = estimateBboxCellCount(box, 5);
    expect(n).toBeGreaterThanOrEqual(1);
    expect(n).toBeLessThanOrEqual(4);
  });

  it('a ~63×63-cell bbox is <= GEOHASH_COVER_CAP (4096); ~70×70 is > cap', () => {
    const box63 = {
      minLat: 31.0,
      maxLat: 31.0 + LAT_STEP * 63,
      minLng: 121.0,
      maxLng: 121.0 + LNG_STEP * 63,
    };
    const box70 = {
      minLat: 31.0,
      maxLat: 31.0 + LAT_STEP * 70,
      minLng: 121.0,
      maxLng: 121.0 + LNG_STEP * 70,
    };
    expect(estimateBboxCellCount(box63, 5)).toBeLessThanOrEqual(GEOHASH_COVER_CAP);
    expect(estimateBboxCellCount(box70, 5)).toBeGreaterThan(GEOHASH_COVER_CAP);
  });

  it('handles an antimeridian-wrapped bbox (minLng > maxLng) with a finite count matching the non-wrapped equivalent width', () => {
    // Wrapped: spans 179.9 → -179.9, i.e. a 0.2°-wide window across the dateline.
    const wrapped = { minLat: 0, maxLat: LAT_STEP * 2, minLng: 179.9, maxLng: -179.9 };
    // Non-wrapped equivalent: same 0.2° longitude width, no dateline.
    const equiv = { minLat: 0, maxLat: LAT_STEP * 2, minLng: 0.0, maxLng: 0.2 };

    const nWrapped = estimateBboxCellCount(wrapped, 5);
    const nEquiv = estimateBboxCellCount(equiv, 5);
    expect(Number.isFinite(nWrapped)).toBe(true);
    expect(nWrapped).toBeGreaterThan(0);
    expect(nWrapped).toBe(nEquiv);
  });
});

describe('isBboxHeatQueryable', () => {
  it('true iff estimateBboxCellCount <= GEOHASH_COVER_CAP (63×63 true, 70×70 false)', () => {
    const box63 = {
      minLat: 31.0,
      maxLat: 31.0 + LAT_STEP * 63,
      minLng: 121.0,
      maxLng: 121.0 + LNG_STEP * 63,
    };
    const box70 = {
      minLat: 31.0,
      maxLat: 31.0 + LAT_STEP * 70,
      minLng: 121.0,
      maxLng: 121.0 + LNG_STEP * 70,
    };
    expect(isBboxHeatQueryable(box63, 5)).toBe(true);
    expect(isBboxHeatQueryable(box70, 5)).toBe(false);
  });

  // BLOCKER 3 cross-check: the gate MUST agree with the SAME enumerator the
  // server uses. The old ceil-based estimate let 64×64 through (estimate=4096)
  // while geohashCellsInBbox actually throws on it (4097 distinct cells) — so
  // the server would 400 a viewport the client said was fine. These cases pin
  // that isBboxHeatQueryable now delegates to the real cover.
  for (let n = 60; n <= 70; n++) {
    it(`a ${n}×${n}-cell box: isBboxHeatQueryable agrees with geohashCellsInBbox`, () => {
      const box = {
        minLat: 31.0,
        maxLat: 31.0 + LAT_STEP * n,
        minLng: 121.0,
        maxLng: 121.0 + LNG_STEP * n,
      };
      const queryable = isBboxHeatQueryable(box, 5);
      if (queryable) {
        // true ⇒ the enumerator does NOT throw AND stays within the cap.
        const cells = geohashCellsInBbox(box, 5);
        expect(cells.length).toBeLessThanOrEqual(GEOHASH_COVER_CAP);
      } else {
        // false ⇒ the enumerator throws the cap error (would 400 server-side).
        expect(() => geohashCellsInBbox(box, 5)).toThrow(GeohashCoverTooLargeError);
      }
    });
  }

  it('the 64×64 boundary box is NOT queryable (old ceil estimate wrongly said yes)', () => {
    const box64 = {
      minLat: 31.0,
      maxLat: 31.0 + LAT_STEP * 64,
      minLng: 121.0,
      maxLng: 121.0 + LNG_STEP * 64,
    };
    expect(isBboxHeatQueryable(box64, 5)).toBe(false);
    expect(() => geohashCellsInBbox(box64, 5)).toThrow(GeohashCoverTooLargeError);
  });
});

describe('gcj02ToWgs84', () => {
  it('round-trips a China point back to WGS-84 within ~1e-4°', () => {
    const p = { lat: 31.23, lng: 121.47 }; // Shanghai (in China)
    const g = wgs84ToGcj02(p.lat, p.lng);
    const back = gcj02ToWgs84(g.lat, g.lng);
    expect(back.lat).toBeCloseTo(p.lat, 4);
    expect(back.lng).toBeCloseTo(p.lng, 4);
    // And the GCJ-02 point itself is actually offset from WGS-84 (non-identity).
    expect(haversineMeters(p.lat, p.lng, g.lat, g.lng)).toBeGreaterThan(100);
  });

  it('is identity outside China', () => {
    const p = { lat: 48.8566, lng: 2.3522 }; // Paris (outside China)
    const back = gcj02ToWgs84(p.lat, p.lng);
    expect(back.lat).toBe(p.lat);
    expect(back.lng).toBe(p.lng);
  });
});
