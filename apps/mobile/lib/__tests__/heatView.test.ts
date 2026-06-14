// RED tests (S3c "附近·热力") for NEW apps/mobile/lib/heatView.ts pure helpers.
// They FAIL now (module not implemented) and PASS once the impl lands. Pure
// math/color — no RN components, so they run under jest-expo without mounting.
//
//   heatColorForCount(count)  → a CSS color string; intensity monotonic in count,
//                               clamped at a documented max so huge counts don't
//                               overflow past the hottest color.
//   regionToBbox(region)      → AMap-style {latitude,longitude,latitudeDelta,
//                               longitudeDelta} → {minLng,minLat,maxLng,maxLat}.
//   decideHeatFetch(box)      → zoom-cap gate via isBboxHeatQueryable:
//                               queryable → {fetch:true,reason:'ok'};
//                               oversized → {fetch:false,reason:'too_large'}.

import { heatColorForCount, regionToBbox, decideHeatFetch } from '../heatView';

// precision-5 angular cell size, used to build queryable / oversized boxes.
const LAT_STEP = 180 / 2 ** 12;
const LNG_STEP = 360 / 2 ** 13;

describe('heatColorForCount', () => {
  it('returns a CSS color string (rgba/hex)', () => {
    const c = heatColorForCount(3);
    expect(typeof c).toBe('string');
    expect(c).toMatch(/^(#|rgba?\()/i);
  });

  it('intensity is monotonic — a low count differs from a high count', () => {
    // The server only returns cells with count>=3 (k-anon), so 3 is the floor.
    const cold = heatColorForCount(3);
    const hot = heatColorForCount(50);
    expect(cold).not.toBe(hot);
  });

  it('clamps at a documented max — counts past the cap map to the hottest color', () => {
    // Beyond the clamp the color stops changing (no overflow past hottest).
    const atMax = heatColorForCount(1000);
    const wayPastMax = heatColorForCount(1_000_000);
    expect(atMax).toBe(wayPastMax);
    // And the clamped/hottest color is distinct from the cold floor.
    expect(atMax).not.toBe(heatColorForCount(3));
  });
});

describe('regionToBbox', () => {
  it('converts an AMap region (center + deltas) to {minLng,minLat,maxLng,maxLat}', () => {
    const region = {
      latitude: 31.2,
      longitude: 121.4,
      latitudeDelta: 0.4,
      longitudeDelta: 0.6,
    };
    const box = regionToBbox(region);
    // Corner math: center ± delta/2.
    expect(box.minLat).toBeCloseTo(31.2 - 0.2, 9);
    expect(box.maxLat).toBeCloseTo(31.2 + 0.2, 9);
    expect(box.minLng).toBeCloseTo(121.4 - 0.3, 9);
    expect(box.maxLng).toBeCloseTo(121.4 + 0.3, 9);
  });
});

describe('decideHeatFetch', () => {
  it('a queryable (within-cap) bbox → {fetch:true, reason:"ok"}', () => {
    const box = {
      minLat: 31.0,
      maxLat: 31.0 + LAT_STEP * 10,
      minLng: 121.0,
      maxLng: 121.0 + LNG_STEP * 10,
    };
    expect(decideHeatFetch(box)).toEqual({ fetch: true, reason: 'ok' });
  });

  it('an oversized (over-cap) bbox → {fetch:false, reason:"too_large"} (zoom-in hint, no fetch)', () => {
    const box = {
      minLat: 31.0,
      maxLat: 31.0 + LAT_STEP * 70,
      minLng: 121.0,
      maxLng: 121.0 + LNG_STEP * 70,
    };
    expect(decideHeatFetch(box)).toEqual({ fetch: false, reason: 'too_large' });
  });
});
