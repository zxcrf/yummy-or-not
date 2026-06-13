// S3c privacy quantization — geohash COVER helpers (packages/shared/src/geo.ts).
//
// The anonymous geo feeds (near + heat) must NOT filter on a precise geog that
// an attacker can shrink to ~1 m and binary-search to recover an exact location.
// The fix snaps every spatial query down to the geohash precision-5 grid: a
// query is resolved to the SET of cells it touches, and rows are filtered by
// `grid_cell = ANY(cells)`. So the finest resolution any query can ever yield is
// one ~5 km cell — two shares in the same cell are indistinguishable.
//
// These pin the cover helpers the quantization depends on:
//   - the cell containing the query center is always returned (a point query of
//     radius 0 must still hit its own cell — never empty).
//   - a small radius that stays inside one cell returns exactly that one cell
//     (an attacker cannot make the result SET finer than a cell).
//   - a radius spanning a cell boundary returns the neighbour cells too (no
//     false negatives — a real nearby share must not be dropped).
//   - the cell count is CAPPED for an absurd query (huge bbox) so a hostile
//     request can't enumerate the planet; the guarantee degrades to "capped",
//     never to "leak precise coords".
//   - every returned cell is a valid precision-5 geohash and the set is unique.

import {
  encodeGeohash,
  geohashCellsInRadius,
  geohashCellsInBbox,
  GEOHASH_COVER_CAP,
  GeohashCoverTooLargeError,
} from '../geo';

describe('geohashCellsInRadius — circle → covering precision-5 cells', () => {
  const LAT = 35.0;
  const LNG = 139.0;
  const ownCell = encodeGeohash(LAT, LNG, 5);

  it('always includes the cell containing the query center (radius 0 / 1 m)', () => {
    const cells = geohashCellsInRadius(LAT, LNG, 1, 5);
    expect(cells).toContain(ownCell);
    expect(cells.length).toBeGreaterThan(0);
  });

  it('a tiny radius that stays inside one cell yields exactly that one cell', () => {
    // 1 m radius cannot reach a neighbour cell (~5 km wide). The attacker's
    // finest possible result is the single cell — never a sub-cell distinction.
    const cells = geohashCellsInRadius(LAT, LNG, 1, 5);
    expect(cells).toEqual([ownCell]);
  });

  it('two centers in the same cell produce the SAME cover set for a sub-cell radius', () => {
    // ~111 m apart but same grid_cell → indistinguishable queries.
    const a = geohashCellsInRadius(35.0, 139.0, 50, 5);
    const b = geohashCellsInRadius(35.001, 139.0, 50, 5);
    expect(a).toEqual(b);
  });

  it('a radius spanning a cell boundary includes neighbour cells (no false negatives)', () => {
    // A precision-5 cell is ~4.9 km; a 10 km radius must reach beyond the home
    // cell. The home cell plus at least one neighbour must be present.
    const cells = geohashCellsInRadius(LAT, LNG, 10_000, 5);
    expect(cells).toContain(ownCell);
    expect(cells.length).toBeGreaterThan(1);
    for (const c of cells) expect(c).toHaveLength(5);
  });

  it('returns a unique set (no duplicate cells)', () => {
    const cells = geohashCellsInRadius(LAT, LNG, 10_000, 5);
    expect(new Set(cells).size).toBe(cells.length);
  });

  it('CAPS the cell count for an absurdly large radius — throws rather than returning a silent partial', () => {
    // An absurd radius wraps all longitudes and covers a huge latitude band.
    // The correct behavior is a typed throw, not a silent partial cover.
    expect(() => geohashCellsInRadius(LAT, LNG, 5_000_000, 5)).toThrow(GeohashCoverTooLargeError);
  });
});

describe('geohashCellsInBbox — bbox → covering precision-5 cells', () => {
  it('a tiny bbox inside one cell yields exactly that one cell', () => {
    const cell = encodeGeohash(35.0, 139.0, 5);
    const cells = geohashCellsInBbox(
      { minLat: 35.0, minLng: 139.0, maxLat: 35.00001, maxLng: 139.00001 },
      5,
    );
    expect(cells).toEqual([cell]);
  });

  it('two distinct points in the SAME cell map a 1 m-each bbox to the same single cell', () => {
    // The heat leak: an attacker shrinks the bbox around one share. Both shares
    // share a cell, so any sub-cell bbox resolves to that one cell → same bucket.
    const cellA = geohashCellsInBbox(
      { minLat: 35.0, minLng: 139.0, maxLat: 35.000005, maxLng: 139.000005 },
      5,
    );
    const cellB = geohashCellsInBbox(
      { minLat: 35.001, minLng: 139.0, maxLat: 35.001005, maxLng: 139.000005 },
      5,
    );
    expect(cellA).toEqual(cellB);
  });

  it('a wide bbox covers multiple cells, all valid precision-5, unique', () => {
    const cells = geohashCellsInBbox(
      { minLat: 34.9, minLng: 138.9, maxLat: 35.2, maxLng: 139.3 },
      5,
    );
    expect(cells.length).toBeGreaterThan(1);
    for (const c of cells) expect(c).toHaveLength(5);
    expect(new Set(cells).size).toBe(cells.length);
  });

  it('CAPS the cell count for a whole-globe bbox — throws rather than returning a silent partial', () => {
    // A globe-spanning bbox covers ~32768 precision-5 cells, far above cap.
    // The fix requires an explicit throw; silently returning the first 4096 in
    // sweep order would hide the ~28000 remaining cells from callers.
    expect(() =>
      geohashCellsInBbox({ minLat: -85, minLng: -179, maxLat: 85, maxLng: 179 }, 5),
    ).toThrow(GeohashCoverTooLargeError);
  });

  it('normalizes a bbox given with LATITUDE-swapped corners (does not affect longitude order)', () => {
    // Only latitude corners need normalization (min/max swap). Longitude order
    // is intentional: minLng > maxLng signals an antimeridian-crossing box. So
    // we test corner normalization using a case where only latitudes are swapped
    // but the longitude range stays non-wrapped (minLng < maxLng).
    const normal = geohashCellsInBbox(
      { minLat: 34.9, minLng: 138.9, maxLat: 35.1, maxLng: 139.1 },
      5,
    );
    const latSwapped = geohashCellsInBbox(
      { minLat: 35.1, minLng: 138.9, maxLat: 34.9, maxLng: 139.1 },
      5,
    );
    expect(new Set(latSwapped)).toEqual(new Set(normal));
  });

  // ── Defect #1: antimeridian (wrapped longitude) ──────────────────────────
  // A bbox that crosses the antimeridian has minLng > maxLng (e.g. 179..-179).
  // Without special handling the implementation treats this as a normal span,
  // producing a near-global sweep that eventually hits the cap and silently
  // misses the actual dateline cells. The fix must detect wrapping and cover
  // BOTH sides of the dateline.
  it('ANTIMERIDIAN: a wrapped bbox (minLng > maxLng) covers cells on BOTH sides of the dateline', () => {
    // A small band spanning the antimeridian: longitude 179° to -179° (i.e. a
    // ~2° wide strip straddling the dateline). Without the split this would be
    // treated as a 358°-wide sweep of almost the entire globe, hit the cap, and
    // return up to 4096 miscellaneous interior cells — missing the actual dateline
    // cells that matter. With the split it returns just the cells on each side.
    const cells = geohashCellsInBbox(
      { minLat: 35.0, minLng: 179.0, maxLat: 35.1, maxLng: -179.0 },
      5,
    );
    // Must contain a cell at longitude +179 (eastern side of dateline).
    const eastCell = encodeGeohash(35.05, 179.5, 5);
    // Must contain a cell at longitude -179 (western side of dateline).
    const westCell = encodeGeohash(35.05, -179.5, 5);
    expect(cells).toContain(eastCell);
    expect(cells).toContain(westCell);
    // The two sides are in genuinely different geohash cells (sanity check).
    expect(eastCell).not.toBe(westCell);
    // Result must be uniquified.
    expect(new Set(cells).size).toBe(cells.length);
  });

  // ── Defect #2: fail-silent cap ────────────────────────────────────────────
  // When the sweep exceeds GEOHASH_COVER_CAP the OLD code returned the first
  // cap cells in sweep order AS IF a complete cover — silently hiding shares
  // outside the prefix. CLAUDE.md forbids fail-silent. The fix must throw a
  // typed GeohashCoverTooLargeError that callers can catch and map to HTTP 400.
  it('OVER-CAP: throws GeohashCoverTooLargeError instead of returning a partial cover', () => {
    // A whole-globe bbox easily exceeds 4096 precision-5 cells (the globe has
    // ~32768 of them).
    expect(() =>
      geohashCellsInBbox(
        { minLat: -85, minLng: -179, maxLat: 85, maxLng: 179 },
        5,
      ),
    ).toThrow(GeohashCoverTooLargeError);
  });

  it('OVER-CAP: the error is an instance of GeohashCoverTooLargeError AND Error', () => {
    let caught: unknown;
    try {
      geohashCellsInBbox({ minLat: -85, minLng: -179, maxLat: 85, maxLng: 179 }, 5);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(GeohashCoverTooLargeError);
    expect(caught).toBeInstanceOf(Error);
    // The error must carry a descriptive message (not blank) so logs are useful.
    expect((caught as Error).message).toBeTruthy();
  });

  it('OVER-CAP: a sane 50 km radius does NOT throw (legitimate queries must work)', () => {
    // MAX_RADIUS_M = 50 000. At 35° lat that covers ~100 precision-5 cells —
    // well below the cap. Must not throw.
    expect(() => geohashCellsInRadius(35.0, 139.0, 50_000, 5)).not.toThrow();
  });
});

describe('geohashCellsInRadius — near-pole / all-longitude', () => {
  // ── Defect #3: near-pole longitude overflow ──────────────────────────────
  // At high |lat|, dLng = radius / (cos(lat) * 111320) can exceed 180° because
  // the cosine shrinks the "metres per degree of longitude". The OLD code's
  // `cosLat > 1e-6` guard catches near-90° but passes the raw overflowing dLng
  // value to the bbox helper for mid-range high latitudes (e.g. 89.9°, 50 km →
  // dLng ≈ 257°), which produced out-of-range longitudes and wrong cells. The
  // fix: when dLng ≥ 180, the circle wraps ALL longitudes at that lat band; use
  // [-180, 180] directly. When the full-longitude sweep is large enough to
  // exceed GEOHASH_COVER_CAP (a precision-5 full-longitude row has ~8192 cells)
  // the helper correctly throws — which is the expected, explicit behavior.

  it('NEAR-POLE: lat=85 with 10 km radius stays within cap and returns valid cells (no out-of-range lng)', () => {
    // cos(85°) ≈ 0.087 → dLng ≈ 1.03° for 10 km. The bbox is ~2° lat × ~2° lng
    // which fits comfortably within the 4096-cell cap (~750 cells). No overflow,
    // no cap breach: a sane high-latitude query that must just work.
    let cells: string[];
    expect(() => {
      cells = geohashCellsInRadius(85, 0, 10_000, 5);
    }).not.toThrow();
    cells!.forEach((c) => {
      expect(c).toHaveLength(5);
      expect(c).toMatch(/^[0-9bcdefghjkmnpqrstuvwxyz]{5}$/);
    });
    expect(cells!.length).toBeGreaterThan(0);
    expect(new Set(cells!).size).toBe(cells!.length);
    // Must include the center cell.
    expect(cells!).toContain(encodeGeohash(85, 0, 5));
  });

  it('NEAR-POLE: lat=89.9 with 50 km radius (dLng ≈ 257°) throws GeohashCoverTooLargeError, NOT a silent wrong result', () => {
    // cos(89.9°) ≈ 0.00175 → dLng ≈ 257° > 180°. The fix routes this through
    // the full-longitude path ([-180, 180]). That lat band is a tiny strip
    // (~0.9° tall × full longitude) but still has far more than 4096 cells at
    // precision 5 (~8192 longitude cells per row). A GeohashCoverTooLargeError
    // is the correct explicit outcome — NOT invalid cell encoding and NOT a
    // silent partial result containing cells from wrong coordinates.
    expect(() => geohashCellsInRadius(89.9, 0, 50_000, 5)).toThrow(GeohashCoverTooLargeError);
  });

  it('NEAR-POLE: the center cell at lat=89.9 is obtainable via encodeGeohash (independent of cover helper)', () => {
    // The cover helper may throw for over-cap queries, but the CENTER cell is
    // always reachable directly. callers that need "just the center cell" use
    // encodeGeohash directly; the cover helper is for range queries.
    const centerCell = encodeGeohash(89.9, 0, 5);
    expect(centerCell).toHaveLength(5);
    expect(centerCell).toMatch(/^[0-9bcdefghjkmnpqrstuvwxyz]{5}$/);
  });

  it('NEAR-POLE: radius exactly at the pole (lat=90) throws GeohashCoverTooLargeError explicitly', () => {
    // At the pole cos(90°)=0 → full-longitude path → cap breach → typed throw.
    // This is correct: a "circle around the pole" of any significant radius
    // covers the entire polar region. Explicit throw beats silent wrong result.
    expect(() => geohashCellsInRadius(90, 0, 1000, 5)).toThrow(GeohashCoverTooLargeError);
  });

  it('NEAR-POLE: antimeridian-crossing radius at moderate lat stays within cap and is correct', () => {
    // lng=179.95, lat=35, radius=10km → dLng ≈ 0.11° → bboxMaxLng ≈ 180.06 > 180
    // → antimeridian split. The wrapped span is tiny (~0.22° × ~0.18°, well under
    // cap). Must return valid cells on both sides of the dateline.
    let cells: string[];
    expect(() => {
      cells = geohashCellsInRadius(35, 179.95, 10_000, 5);
    }).not.toThrow();
    cells!.forEach((c) => {
      expect(c).toHaveLength(5);
      expect(c).toMatch(/^[0-9bcdefghjkmnpqrstuvwxyz]{5}$/);
    });
    expect(new Set(cells!).size).toBe(cells!.length);
    expect(cells!.length).toBeGreaterThan(0);
    // Center cell (east side of dateline) must be present.
    expect(cells!).toContain(encodeGeohash(35, 179.95, 5));
    // The overflow pushes into the western hemisphere; cells near lng=-180 must
    // be included (the western side of the dateline split).
    expect(cells!).toContain(encodeGeohash(35, -179.99, 5));
  });
});
