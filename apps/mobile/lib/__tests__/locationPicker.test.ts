/* ============================================================
   Unit tests — LocationPicker coordinate seam (lib/locationPicker.ts).

   The picker mounts a native AMap MapView (not jest-mountable), so its one
   load-bearing piece of logic — the WGS-84 ↔ GCJ-02 conversion between stored
   pins and the AMap camera — lives in a pure module and is tested here.

   The bug these guard against is a swapped/missing conversion: AMap speaks
   GCJ-02, the app stores WGS-84. Inside China the two differ by ~hundreds of
   metres, so dropping or duplicating the conversion lands every pin off. The
   round-trip / inverse assertions fail loudly if that ever regresses; the
   overseas cases pin the documented identity behavior.
   ============================================================ */

import { isInsideChina, wgs84ToGcj02 } from '@yon/shared'

import {
  PICKER_FALLBACK,
  PICK_ZOOM,
  initialCameraFromPin,
  pinFromCameraTarget,
} from '../locationPicker'

// A clearly-inside-China point (Shanghai People's Square, WGS-84).
const CHINA = { lat: 31.2304, lng: 121.4737 }
// A clearly-overseas point (Times Square, NYC) — GCJ-02 transform is identity.
const OVERSEAS = { lat: 40.758, lng: -73.9855 }

describe('initialCameraFromPin (WGS-84 seed → GCJ-02 camera)', () => {
  it('opens at PICK_ZOOM', () => {
    expect(initialCameraFromPin(CHINA).zoom).toBe(PICK_ZOOM)
    expect(initialCameraFromPin(OVERSEAS).zoom).toBe(PICK_ZOOM)
  })

  it('applies the GCJ-02 offset for a China seed (camera ≠ raw WGS-84)', () => {
    const { target } = initialCameraFromPin(CHINA)
    // The camera target is shifted off the raw WGS-84 seed...
    expect(target.latitude).not.toBeCloseTo(CHINA.lat, 4)
    expect(target.longitude).not.toBeCloseTo(CHINA.lng, 4)
    // ...by a realistic GCJ shift: hundreds of metres, i.e. ~1e-4°–1e-2°.
    const dLat = Math.abs(target.latitude - CHINA.lat)
    const dLng = Math.abs(target.longitude - CHINA.lng)
    expect(dLat).toBeGreaterThan(1e-4)
    expect(dLat).toBeLessThan(1e-2)
    expect(dLng).toBeGreaterThan(1e-4)
    expect(dLng).toBeLessThan(1e-2)
    // And it matches the shared forward transform exactly (no drift).
    const g = wgs84ToGcj02(CHINA.lat, CHINA.lng)
    expect(target.latitude).toBe(g.lat)
    expect(target.longitude).toBe(g.lng)
  })

  it('leaves an overseas seed unchanged (identity outside China)', () => {
    const { target } = initialCameraFromPin(OVERSEAS)
    expect(target.latitude).toBe(OVERSEAS.lat)
    expect(target.longitude).toBe(OVERSEAS.lng)
  })
})

describe('pinFromCameraTarget (GCJ-02 camera center → WGS-84 pin)', () => {
  it('shifts a China camera center back toward WGS-84', () => {
    // Feed it a GCJ-02 point; the recovered pin must move off it.
    const g = wgs84ToGcj02(CHINA.lat, CHINA.lng)
    const pin = pinFromCameraTarget({ latitude: g.lat, longitude: g.lng })
    expect(pin.lat).not.toBeCloseTo(g.lat, 4)
    expect(pin.lng).not.toBeCloseTo(g.lng, 4)
  })

  it('leaves an overseas camera center unchanged (identity outside China)', () => {
    const pin = pinFromCameraTarget({ latitude: OVERSEAS.lat, longitude: OVERSEAS.lng })
    expect(pin.lat).toBe(OVERSEAS.lat)
    expect(pin.lng).toBe(OVERSEAS.lng)
  })
})

describe('round-trip: pin → camera → pin', () => {
  // The critical invariant. If the two helpers ever used the SAME direction
  // (a swapped-conversion regression), a China round-trip would drift by ~2×
  // the GCJ offset — hundreds of metres — and blow past the 1e-4° tolerance.
  it('recovers a China pin within ~1e-4° (true inverse, not duplicated)', () => {
    const { target } = initialCameraFromPin(CHINA)
    const back = pinFromCameraTarget(target)
    expect(back.lat).toBeCloseTo(CHINA.lat, 4)
    expect(back.lng).toBeCloseTo(CHINA.lng, 4)
  })

  it('recovers an overseas pin exactly (identity both ways)', () => {
    const { target } = initialCameraFromPin(OVERSEAS)
    const back = pinFromCameraTarget(target)
    expect(back.lat).toBe(OVERSEAS.lat)
    expect(back.lng).toBe(OVERSEAS.lng)
  })

  it('round-trips a spread of China cities under one cell of error', () => {
    const cities = [
      { lat: 39.9087, lng: 116.3975 }, // Beijing, Tiananmen
      { lat: 23.1291, lng: 113.2644 }, // Guangzhou
      { lat: 30.5728, lng: 104.0668 }, // Chengdu
      { lat: 22.5431, lng: 114.0579 }, // Shenzhen
    ]
    for (const c of cities) {
      const back = pinFromCameraTarget(initialCameraFromPin(c).target)
      expect(back.lat).toBeCloseTo(c.lat, 4)
      expect(back.lng).toBeCloseTo(c.lng, 4)
    }
  })
})

describe('PICKER_FALLBACK', () => {
  it('is the Shanghai default and lies inside China (so the gate uses AMap-side coords)', () => {
    expect(PICKER_FALLBACK).toEqual({ lat: 31.2304, lng: 121.4737 })
    expect(isInsideChina(PICKER_FALLBACK.lat, PICKER_FALLBACK.lng)).toBe(true)
  })
})
