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

// ── Geohash COVER (S3c privacy quantization) ─────────────────────────────────
// The anonymous geo feeds (near + heat) must never filter on a precise geog an
// attacker can shrink to ~1 m and binary-search to recover an exact location.
// Instead a spatial query is resolved to the SET of precision-5 cells it touches
// and rows are filtered by `grid_cell = ANY(cells)`. The finest resolution any
// query can ever yield is then one ~5 km cell: two shares in the same cell are
// indistinguishable across ALL queries. These helpers compute that covering set.
//
// Enumeration is bounded: a hostile huge bbox/radius is CAPPED to
// GEOHASH_COVER_CAP cells rather than enumerating the planet. Capping never
// weakens the privacy guarantee (still cell-grain) — it only limits how many
// cells one query returns.

/** Max number of covering cells any single query may enumerate. A precision-5
 *  cell is ~4.9 km; 4096 cells ≈ a ~300 km × 300 km window, well past any
 *  legitimate "nearby" feed (MAX_RADIUS 50 km) or sane heat viewport. */
export const GEOHASH_COVER_CAP = 4096;

/** Thrown when a spatial query resolves to more than GEOHASH_COVER_CAP cells.
 *  Callers (routes) should map this to HTTP 400 `area_too_large`; it is NOT an
 *  internal server error. Returning a partial cover silently would hide rows from
 *  the feed (CLAUDE.md: "Fail explicitly, don't fail silently"). */
export class GeohashCoverTooLargeError extends Error {
  constructor(detail: string) {
    super(`geohash cover exceeded ${GEOHASH_COVER_CAP}-cell cap: ${detail}`);
    this.name = 'GeohashCoverTooLargeError';
    // Ensure instanceof works across transpilation boundaries.
    Object.setPrototypeOf(this, GeohashCoverTooLargeError.prototype);
  }
}

/** The angular height (degrees) of one geohash cell at the given precision.
 *  precision-5 → 5-char hash → 25 bits → 12 lat bits → 180/2^12 ≈ 0.0439°. */
function geohashLatStep(precision: number): number {
  const latBits = Math.floor((precision * 5) / 2);
  return 180 / 2 ** latBits;
}

/** The angular width (degrees) of one geohash cell at the given precision.
 *  precision-5 → 13 lng bits → 360/2^13 ≈ 0.0439°. */
function geohashLngStep(precision: number): number {
  const lngBits = Math.ceil((precision * 5) / 2);
  return 360 / 2 ** lngBits;
}

/** Sweep one longitude band [minLng, maxLng] (non-wrapped) for the given
 *  latitude band into `out`. Returns false immediately if the cap is hit. */
function sweepLngBand(
  minLat: number,
  maxLat: number,
  minLng: number,
  maxLng: number,
  latInc: number,
  lngInc: number,
  precision: number,
  out: Set<string>,
): boolean {
  for (let lat = minLat; ; lat += latInc) {
    const clampedLat = Math.min(lat, maxLat);
    for (let lng = minLng; ; lng += lngInc) {
      const clampedLng = Math.min(lng, maxLng);
      out.add(encodeGeohash(clampedLat, clampedLng, precision));
      if (out.size > GEOHASH_COVER_CAP) return false; // cap exceeded
      if (clampedLng >= maxLng) break;
    }
    if (clampedLat >= maxLat) break;
  }
  return true;
}

/** Enumerate the precision-`precision` geohash cells covering the given WGS-84
 *  bounding box.
 *
 *  - Corner order doesn't matter (latitude is normalized).
 *  - Wrapped (antimeridian-crossing) boxes where minLng > maxLng are split into
 *    two non-wrapped halves so cells on both sides of the dateline are covered.
 *  - Throws GeohashCoverTooLargeError if the cover exceeds GEOHASH_COVER_CAP so
 *    callers get an explicit signal instead of a silent partial result. */
export function geohashCellsInBbox(box: GeohashBounds, precision = 5): string[] {
  const minLat = Math.max(-90, Math.min(box.minLat, box.maxLat));
  const maxLat = Math.min(90, Math.max(box.minLat, box.maxLat));

  const latStep = geohashLatStep(precision);
  const lngStep = geohashLngStep(precision);
  const latInc = latStep / 2;
  const lngInc = lngStep / 2;

  const cells = new Set<string>();

  // Detect antimeridian-crossing (wrapped) bbox: minLng > maxLng means the box
  // spans the dateline (e.g. 179..-179). Split into [minLng, 180] ∪ [-180, maxLng].
  const isWrapped = box.minLng > box.maxLng;
  if (isWrapped) {
    const ok1 = sweepLngBand(minLat, maxLat, box.minLng, 180, latInc, lngInc, precision, cells);
    if (!ok1) throw new GeohashCoverTooLargeError(`wrapped bbox ${JSON.stringify(box)}`);
    const ok2 = sweepLngBand(minLat, maxLat, -180, box.maxLng, latInc, lngInc, precision, cells);
    if (!ok2) throw new GeohashCoverTooLargeError(`wrapped bbox ${JSON.stringify(box)}`);
  } else {
    const minLng = Math.min(box.minLng, box.maxLng);
    const maxLng = Math.max(box.minLng, box.maxLng);
    const ok = sweepLngBand(minLat, maxLat, minLng, maxLng, latInc, lngInc, precision, cells);
    if (!ok) throw new GeohashCoverTooLargeError(`bbox ${JSON.stringify(box)}`);
  }

  return Array.from(cells);
}

/** Enumerate the precision-`precision` geohash cells covering a circle of
 *  `radiusM` metres around (lat,lng).
 *
 *  Near the poles the longitude span can exceed 180° (cos(lat) → 0), which
 *  produces out-of-range longitudes. When dLng ≥ 180 the circle wraps all
 *  longitudes at that latitude band; we cover [-180, 180] directly instead of
 *  passing overflowing values to the bbox helper. For antimeridian-crossing
 *  boxes (lng ± dLng straddles ±180) we pass the wrapped form so the bbox helper
 *  splits it correctly. Throws GeohashCoverTooLargeError when the resulting
 *  cover exceeds GEOHASH_COVER_CAP. */
export function geohashCellsInRadius(
  lat: number,
  lng: number,
  radiusM: number,
  precision = 5,
): string[] {
  const r = Math.max(0, radiusM);
  const dLat = r / 111_320; // metres per degree latitude (≈ constant)
  const cosLat = Math.abs(Math.cos((lat * Math.PI) / 180));

  if (cosLat < 1e-9 || r / (111_320 * cosLat) >= 180) {
    // The circle covers all longitudes at this lat band. Use a full-longitude
    // bbox so no out-of-range coordinates are generated.
    return geohashCellsInBbox(
      {
        minLat: lat - dLat,
        maxLat: lat + dLat,
        minLng: -180,
        maxLng: 180,
      },
      precision,
    );
  }

  const dLng = r / (111_320 * cosLat);
  const bboxMinLng = lng - dLng;
  const bboxMaxLng = lng + dLng;

  // Antimeridian crossing: lng + dLng > 180 or lng - dLng < -180. Normalise
  // to a wrapped bbox (minLng > maxLng) so geohashCellsInBbox splits it into
  // [minLng,180] ∪ [-180,maxLng].
  //   East overflow (lng+dLng > 180): keep minLng as-is; wrap maxLng back by -360.
  //   West overflow (lng-dLng < -180): wrap minLng forward by +360; keep maxLng.
  if (bboxMaxLng > 180) {
    return geohashCellsInBbox(
      { minLat: lat - dLat, maxLat: lat + dLat, minLng: bboxMinLng, maxLng: bboxMaxLng - 360 },
      precision,
    );
  }
  if (bboxMinLng < -180) {
    return geohashCellsInBbox(
      { minLat: lat - dLat, maxLat: lat + dLat, minLng: bboxMinLng + 360, maxLng: bboxMaxLng },
      precision,
    );
  }

  return geohashCellsInBbox(
    {
      minLat: lat - dLat,
      maxLat: lat + dLat,
      minLng: bboxMinLng,
      maxLng: bboxMaxLng,
    },
    precision,
  );
}

// ── Geohash heat layer (S3c "附近·热力" AMap map) ──────────────────────────────
// The AMap heat layer renders one polygon per precision-5 cell. Two privacy +
// correctness constraints (see docs/product/plans/share-and-circles.md §S3c):
//   - AMap consumes GCJ-02. A raw WGS-84 cell center/corner drifts ~hundreds of
//     metres in China, so EVERY coordinate fed to amap must pass wgs84ToGcj02.
//   - The viewport gate must agree with the server's GEOHASH_COVER_CAP so a
//     viewport that would 400 `area_too_large` is refused client-side BEFORE
//     fetching (zoom-cap). estimateBboxCellCount is the cheap analytic estimate
//     (no enumeration) used for that gate.

/** A precision-`cell`-length geohash cell's center, shifted WGS-84 → GCJ-02 so
 *  it can be fed directly to AMap. In China the GCJ-02 offset is ~hundreds of
 *  metres from the raw WGS-84 midpoint; outside China wgs84ToGcj02 is identity. */
export function geohashCellCenterGcj02(cell: string): { lat: number; lng: number } {
  const b = decodeGeohashBounds(cell);
  const midLat = (b.minLat + b.maxLat) / 2;
  const midLng = (b.minLng + b.maxLng) / 2;
  return wgs84ToGcj02(midLat, midLng);
}

/** The 4 GCJ-02 corners (amap {latitude,longitude} shape) of a geohash cell,
 *  for an AMap Polygon. Each WGS-84 corner is converted independently via
 *  wgs84ToGcj02 (the offset varies slightly across the cell, so the rect stays
 *  a real non-degenerate quad that strictly bounds geohashCellCenterGcj02). */
export function geohashCellRectGcj02(
  cell: string,
): Array<{ latitude: number; longitude: number }> {
  const b = decodeGeohashBounds(cell);
  const corners: Array<[number, number]> = [
    [b.minLat, b.minLng],
    [b.minLat, b.maxLng],
    [b.maxLat, b.maxLng],
    [b.maxLat, b.minLng],
  ];
  return corners.map(([lat, lng]) => {
    const g = wgs84ToGcj02(lat, lng);
    return { latitude: g.lat, longitude: g.lng };
  });
}

/** Grid-aligned UPPER bound on the precision-`precision` geohash cells covering a
 *  bbox — `(ceil(latSpan/latStep)+1) * (ceil(lngSpan/lngStep)+1)`, NO enumeration.
 *
 *  The trailing `+1` per axis is what makes this a true UPPER bound that never
 *  undercounts the real enumerator (geohashCellsInBbox): a span of width w placed
 *  at an arbitrary grid offset can straddle one extra cell boundary, so a plain
 *  `ceil(w/step)` (or `floor(w/step)+1`) can be one short — e.g. a 64-cell-wide
 *  box can touch 65 distinct cells. Undercounting would let through a viewport the
 *  server then 400s `area_too_large`. (The authoritative zoom-cap gate is
 *  isBboxHeatQueryable, which delegates to the enumerator; this estimate is the
 *  cheap O(1) bound for UI hints.)
 *
 *  Position-independent (depends only on span widths), so a wrapped window and a
 *  non-wrapped one of equal width yield the same count.
 *
 *  Antimeridian: when `box.minLng > box.maxLng` the box wraps the dateline; the
 *  longitude span is the wrapped width `(maxLng - minLng + 360) % 360`. */
export function estimateBboxCellCount(box: GeohashBounds, precision = 5): number {
  const latStep = geohashLatStep(precision);
  const lngStep = geohashLngStep(precision);

  const latSpan = Math.abs(box.maxLat - box.minLat);
  const lngSpan =
    box.minLng > box.maxLng
      ? ((box.maxLng - box.minLng + 360) % 360)
      : box.maxLng - box.minLng;

  const latCells = Math.ceil(latSpan / latStep) + 1;
  const lngCells = Math.ceil(lngSpan / lngStep) + 1;
  return latCells * lngCells;
}

/** Whether a heat query for this bbox is allowed. AUTHORITATIVE: delegates to the
 *  SAME enumerator the server uses (geohashCellsInBbox), so the client-side
 *  zoom-cap gate exactly matches the server's GEOHASH_COVER_CAP — a viewport that
 *  would 400 `area_too_large` is refused before fetching, and one that wouldn't is
 *  never spuriously blocked. estimateBboxCellCount stays as the cheap O(1)
 *  upper-bound (e.g. for UI hints), but the gate itself uses the real cover. */
export function isBboxHeatQueryable(box: GeohashBounds, precision = 5): boolean {
  try {
    geohashCellsInBbox(box, precision);
    return true;
  } catch (e) {
    if (e instanceof GeohashCoverTooLargeError) return false;
    throw e;
  }
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

/** Convert a GCJ-02 coordinate back to WGS-84 (the standard one-step inverse of
 *  wgs84ToGcj02). AMap returns camera/region coords in GCJ-02, but the server's
 *  geohash space is WGS-84, so every viewport corner sent to the geo heat/feed
 *  endpoints MUST pass through this first. Outside China the transform is
 *  identity (matching wgs84ToGcj02). Accuracy is ~1e-4° (well under one cell).
 *  Input lat/lng are treated as the GCJ-02 point; we compute the forward offset
 *  AT that point and subtract it (g = wgs84ToGcj02(lat,lng); wgs = 2*p - g). */
export function gcj02ToWgs84(lat: number, lng: number): { lat: number; lng: number } {
  if (!isInsideChina(lat, lng)) return { lat, lng };
  const g = wgs84ToGcj02(lat, lng);
  return { lat: lat * 2 - g.lat, lng: lng * 2 - g.lng };
}
