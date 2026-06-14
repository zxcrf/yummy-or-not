/* ============================================================
   YUMMY OR NOT — heatView (pure helpers for "附近·热力")
   No RN components / no react-native-amap3d import here, so these run
   under jest-expo without mounting a native MapView.

   - heatColorForCount(count): a CSS color string whose intensity rises
     monotonically with the cell's taste count, clamped at HEAT_CLAMP so
     huge counts never overflow past the hottest color.
   - regionToBbox(region): AMap region (center + deltas) → bbox.
   - decideHeatFetch(box): zoom-cap gate via isBboxHeatQueryable — an
     oversized bbox would 400 area_too_large server-side, so we refuse to
     fetch and signal the "放大查看" hint instead.
   ============================================================ */

import { isBboxHeatQueryable, type GeohashBounds } from '@yon/shared'

/** Count at/above which the color stops changing (single hottest color).
 *  The server floor is count>=3 (k-anon); this caps the warm end so a
 *  cell with 1000 tastes and one with 1,000,000 render identically. */
export const HEAT_CLAMP = 50

// Cold → hot ramp (low to high count). RGB endpoints interpolated by a
// normalized, clamped intensity. count===3 (floor) maps near COLD,
// count>=HEAT_CLAMP maps to HOT.
const COLD = { r: 0x2f, g: 0x6b, b: 0xff } // candyBlue-ish (cool)
const HOT = { r: 0xff, g: 0x31, b: 0x47 } // verdictNah (hot)

function lerp(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t)
}

/**
 * Monotonic heat color. Returns an `rgba(...)` string (matches /^rgba?\(/).
 * Intensity = clamp((count - 3) / (HEAT_CLAMP - 3), 0, 1); counts at/above
 * HEAT_CLAMP all map to the single hottest color.
 */
export function heatColorForCount(count: number): string {
  const floor = 3
  const span = HEAT_CLAMP - floor
  const raw = (count - floor) / span
  const t = Math.max(0, Math.min(1, raw))
  const r = lerp(COLD.r, HOT.r, t)
  const g = lerp(COLD.g, HOT.g, t)
  const b = lerp(COLD.b, HOT.b, t)
  // Alpha also climbs with intensity so denser cells read hotter on the map,
  // but stays opaque enough at the floor to be visible.
  const alpha = (0.35 + 0.45 * t).toFixed(3)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

export interface AmapRegion {
  latitude: number
  longitude: number
  latitudeDelta: number
  longitudeDelta: number
}

export interface Bbox {
  minLng: number
  minLat: number
  maxLng: number
  maxLat: number
}

/** AMap region (center + deltas) → {minLng,minLat,maxLng,maxLat}. */
export function regionToBbox(region: AmapRegion): Bbox {
  const halfLat = region.latitudeDelta / 2
  const halfLng = region.longitudeDelta / 2
  return {
    minLat: region.latitude - halfLat,
    maxLat: region.latitude + halfLat,
    minLng: region.longitude - halfLng,
    maxLng: region.longitude + halfLng,
  }
}

/**
 * Zoom-cap gate. A queryable bbox → fetch; an oversized bbox (would exceed
 * the geohash cover cap / 400 area_too_large) → do NOT fetch, show the
 * "放大查看" hint. The {minLng,minLat,maxLng,maxLat} shape matches
 * GeohashBounds, so it feeds isBboxHeatQueryable directly.
 */
export function decideHeatFetch(box: Bbox): {
  fetch: boolean
  reason: 'ok' | 'too_large'
} {
  return isBboxHeatQueryable(box as GeohashBounds)
    ? { fetch: true, reason: 'ok' }
    : { fetch: false, reason: 'too_large' }
}
