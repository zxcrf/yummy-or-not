/* Coordinate transform utilities for Yummy or Not.
   wgs84ToGcj02: WGS-84 (GPS/standard) → GCJ-02 (China offset-corrected).
   isInsideChina: coarse bounding-box check used to select the AMap provider.

   Algorithm is the standard "eviltransform" / wgs2gcj formula, public domain. */

const a = 6378245.0;
const ee = 0.00669342162296594323;

function transformLat(x: number, y: number): number {
  let ret =
    -100.0 +
    2.0 * x +
    3.0 * y +
    0.2 * y * y +
    0.1 * x * y +
    0.2 * Math.sqrt(Math.abs(x));
  ret += ((20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0) / 3.0;
  ret += ((20.0 * Math.sin(y * Math.PI) + 40.0 * Math.sin((y / 3.0) * Math.PI)) * 2.0) / 3.0;
  ret += ((160.0 * Math.sin((y / 12.0) * Math.PI) + 320 * Math.sin((y * Math.PI) / 30.0)) * 2.0) / 3.0;
  return ret;
}

function transformLng(x: number, y: number): number {
  let ret =
    300.0 +
    x +
    2.0 * y +
    0.1 * x * x +
    0.1 * x * y +
    0.1 * Math.sqrt(Math.abs(x));
  ret += ((20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0) / 3.0;
  ret += ((20.0 * Math.sin(x * Math.PI) + 40.0 * Math.sin((x / 3.0) * Math.PI)) * 2.0) / 3.0;
  ret += ((150.0 * Math.sin((x / 12.0) * Math.PI) + 300.0 * Math.sin((x / 30.0) * Math.PI)) * 2.0) / 3.0;
  return ret;
}

/** Coarse bounding-box check: is the WGS-84 point roughly inside mainland China?
 *  Used to select the AMap geocoder vs Nominatim. */
export function isInsideChina(lat: number, lng: number): boolean {
  return lat >= 3.86 && lat <= 53.55 && lng >= 73.66 && lng <= 135.05;
}

/** Great-circle distance between two WGS-84 points in meters (Haversine formula, R=6371000). */
export function haversineMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6_371_000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(bLat - aLat)
  const dLng = toRad(bLng - aLng)
  const sinDLat = Math.sin(dLat / 2)
  const sinDLng = Math.sin(dLng / 2)
  const a2 = sinDLat * sinDLat + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * sinDLng * sinDLng
  return 2 * R * Math.asin(Math.sqrt(a2))
}

/** Human-readable distance: <1000 m → "999 m"; ≥1000 m → "1.4 km". */
export function formatDistance(meters: number): string {
  // Branch on the rounded value so 999.6 m promotes to "1.0 km", not "1000 m".
  if (Math.round(meters) < 1000) return `${Math.round(meters)} m`
  return `${(meters / 1000).toFixed(1)} km`
}

// ── Geohash (S3c) ───────────────────────────────────────────────────────────
// Pure-function geohash encode/decode for the geo-visibility grid layer. Two
// jobs (see docs/product/plans/share-and-circles.md §S3c): (a) COARSEN a precise
// coordinate to a privacy-safe ~5 km cell so the public feed can never recover
// an exact location, and (b) DECODE a cell back to its bounding box for the heat
// grid. Precision 5 is the grid_cell grain the plan pins (~4.9 km × 4.9 km).
//
// Standard base-32 geohash (Gustavo Niemeyer's algorithm, public domain). Deter-
// ministic math — no DB, no PostGIS — so it is plain-unit-testable.

const GEOHASH_BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

/** Encode a WGS-84 coordinate into a base-32 geohash string.
 *  @param precision number of geohash characters (default 5 — the plan's grid_cell grain). */
export function encodeGeohash(lat: number, lng: number, precision = 5): string {
  let minLat = -90;
  let maxLat = 90;
  let minLng = -180;
  let maxLng = 180;

  let hash = '';
  let bit = 0;
  let ch = 0;
  // Even bits bisect longitude, odd bits bisect latitude (the geohash interleave).
  let even = true;

  while (hash.length < precision) {
    if (even) {
      const mid = (minLng + maxLng) / 2;
      if (lng >= mid) {
        ch = (ch << 1) | 1;
        minLng = mid;
      } else {
        ch = ch << 1;
        maxLng = mid;
      }
    } else {
      const mid = (minLat + maxLat) / 2;
      if (lat >= mid) {
        ch = (ch << 1) | 1;
        minLat = mid;
      } else {
        ch = ch << 1;
        maxLat = mid;
      }
    }
    even = !even;

    if (bit < 4) {
      bit += 1;
    } else {
      hash += GEOHASH_BASE32.charAt(ch);
      bit = 0;
      ch = 0;
    }
  }
  return hash;
}

/** A geohash cell's bounding box (WGS-84 degrees). */
export interface GeohashBounds {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

/** Decode a base-32 geohash string back to its bounding box. The point it was
 *  encoded from is guaranteed to lie inside this box; the box CENTER re-encodes
 *  to the same cell (stable privacy bucket). */
export function decodeGeohashBounds(hash: string): GeohashBounds {
  let minLat = -90;
  let maxLat = 90;
  let minLng = -180;
  let maxLng = 180;
  let even = true;

  for (const char of hash.toLowerCase()) {
    const idx = GEOHASH_BASE32.indexOf(char);
    if (idx === -1) continue; // skip invalid chars defensively
    for (let mask = 16; mask > 0; mask >>= 1) {
      const on = (idx & mask) !== 0;
      if (even) {
        const mid = (minLng + maxLng) / 2;
        if (on) minLng = mid;
        else maxLng = mid;
      } else {
        const mid = (minLat + maxLat) / 2;
        if (on) minLat = mid;
        else maxLat = mid;
      }
      even = !even;
    }
  }
  return { minLat, maxLat, minLng, maxLng };
}

/** Convert a WGS-84 coordinate to GCJ-02 (China Mars coordinate).
 *  Returns the input unchanged if the point is outside China. */
export function wgs84ToGcj02(lat: number, lng: number): { lat: number; lng: number } {
  if (!isInsideChina(lat, lng)) return { lat, lng };

  let dLat = transformLat(lng - 105.0, lat - 35.0);
  let dLng = transformLng(lng - 105.0, lat - 35.0);

  const radLat = (lat / 180.0) * Math.PI;
  let magic = Math.sin(radLat);
  magic = 1 - ee * magic * magic;
  const sqrtMagic = Math.sqrt(magic);

  dLat = (dLat * 180.0) / ((a * (1 - ee)) / (magic * sqrtMagic) * Math.PI);
  dLng = (dLng * 180.0) / ((a / sqrtMagic) * Math.cos(radLat) * Math.PI);

  return { lat: lat + dLat, lng: lng + dLng };
}
