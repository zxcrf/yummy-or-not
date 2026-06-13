// S3c geohash pure-function unit tests — packages/shared/src/geo.ts.
//
// The plan (docs/product/plans/share-and-circles.md §S3c) adds geohash
// encode/decode as PURE functions in the existing geo.ts so the grid layer can
// (a) coarsen a precise coordinate to a privacy-safe cell and (b) decode a cell
// back to a bounding box for the heat grid. These are deterministic math — no
// DB, no PostGIS — so they are plain unit tests with known reference vectors.
//
// Why precision 5: the plan pins `grid_cell text -- geohash precision 5`. A
// precision-5 cell is ~4.9 km × 4.9 km, the privacy-coarsening grain the geo
// feed snaps every public location to.
//
// FAILS today: geo.ts exports neither encodeGeohash nor decodeGeohashBounds.
// PASSES once S3c adds them. These pin the specific invariants the privacy /
// heat layers depend on, not just "a function exists":
//   - known reference vectors (well-published geohash values).
//   - precision-5 default produces a 5-char cell.
//   - encode→decode round-trips: the original point lies inside the decoded box.
//   - the center of a decoded cell re-encodes to the same cell (coarsening is
//     idempotent — this is what makes the cell a stable privacy bucket).
//   - cross-meridian (negative longitude) and equator (lat/lng = 0) cases.

import { encodeGeohash, decodeGeohashBounds } from '../geo';

describe('encodeGeohash — precision 5 grid cell', () => {
  it('encodes a well-known reference point (near 57.649, 10.407 → "u4pruy...")', () => {
    // Classic geohash spec example: 57.64911,10.40744 → "u4pruydqqvj" at
    // precision 11; the precision-5 prefix is "u4pru".
    expect(encodeGeohash(57.64911, 10.40744, 5)).toBe('u4pru');
  });

  it('defaults to precision 5 when no precision is passed (the plan grid_cell grain)', () => {
    const cell = encodeGeohash(57.64911, 10.40744);
    expect(cell).toHaveLength(5);
    expect(cell).toBe('u4pru');
  });

  it('encodes the equator/prime-meridian origin (0,0) into the expected "s0000" cell', () => {
    // 0°,0° is a published geohash edge case → prefix "s0000".
    expect(encodeGeohash(0, 0, 5)).toBe('s0000');
  });

  it('handles cross-meridian / western-hemisphere negative longitude (San Francisco)', () => {
    // 37.7749,-122.4194 (San Francisco) → precision-5 geohash "9q8yy".
    expect(encodeGeohash(37.7749, -122.4194, 5)).toBe('9q8yy');
  });

  it('two points in the same ~5 km cell collapse to the SAME grid_cell (coarsening)', () => {
    // The whole point of grid_cell: nearby precise coords must map to one cell
    // so the feed can never distinguish them (privacy) and the heat map can
    // bucket them (aggregation). These two differ by ~100 m.
    const a = encodeGeohash(35.0, 139.0, 5);
    const b = encodeGeohash(35.001, 139.0, 5);
    expect(a).toBe(b);
  });

  it('two points in clearly different regions get DIFFERENT cells', () => {
    expect(encodeGeohash(35.0, 139.0, 5)).not.toBe(encodeGeohash(40.0, -74.0, 5));
  });
});

describe('decodeGeohashBounds — cell → bounding box', () => {
  it('decodes a cell to a box that CONTAINS the point it was encoded from', () => {
    const lat = 57.64911;
    const lng = 10.40744;
    const cell = encodeGeohash(lat, lng, 5);
    const b = decodeGeohashBounds(cell);
    expect(lat).toBeGreaterThanOrEqual(b.minLat);
    expect(lat).toBeLessThanOrEqual(b.maxLat);
    expect(lng).toBeGreaterThanOrEqual(b.minLng);
    expect(lng).toBeLessThanOrEqual(b.maxLng);
  });

  it('a precision-5 cell box is roughly the documented ~5 km span (not a point, not the whole globe)', () => {
    const b = decodeGeohashBounds('u4pru');
    const latSpanDeg = b.maxLat - b.minLat;
    const lngSpanDeg = b.maxLng - b.minLng;
    // precision-5 lat cell ≈ 0.0439°, lng cell ≈ 0.0439°. Allow generous slack
    // but pin the order of magnitude so a precision regression (e.g. p4 or p6)
    // is caught.
    expect(latSpanDeg).toBeGreaterThan(0.02);
    expect(latSpanDeg).toBeLessThan(0.09);
    expect(lngSpanDeg).toBeGreaterThan(0.02);
    expect(lngSpanDeg).toBeLessThan(0.09);
  });

  it('re-encoding the center of a decoded cell yields the SAME cell (stable privacy bucket)', () => {
    const cell = 'u4pru';
    const b = decodeGeohashBounds(cell);
    const centerLat = (b.minLat + b.maxLat) / 2;
    const centerLng = (b.minLng + b.maxLng) / 2;
    expect(encodeGeohash(centerLat, centerLng, 5)).toBe(cell);
  });

  it('round-trips a cross-meridian (negative lng) point inside its decoded box', () => {
    const lat = 37.7749;
    const lng = -122.4194;
    const b = decodeGeohashBounds(encodeGeohash(lat, lng, 5));
    expect(lng).toBeGreaterThanOrEqual(b.minLng);
    expect(lng).toBeLessThanOrEqual(b.maxLng);
    // Negative-longitude box must stay in the western hemisphere — a sign bug
    // would push the box across the meridian.
    expect(b.maxLng).toBeLessThan(0);
  });

  it('round-trips the equator origin (0,0) inside its decoded box', () => {
    const b = decodeGeohashBounds(encodeGeohash(0, 0, 5));
    expect(0).toBeGreaterThanOrEqual(b.minLat);
    expect(0).toBeLessThanOrEqual(b.maxLat);
    expect(0).toBeGreaterThanOrEqual(b.minLng);
    expect(0).toBeLessThanOrEqual(b.maxLng);
  });
});
