/* ============================================================
   Regression test (issue #97) — 附近·热力 default-locates on entry.

   Requirement 3: entering the Nearby tab centers the AMap camera on the
   user's CURRENT GPS, converted to GCJ-02 (AMap's CRS) so it isn't offset.
   On permission-deny / failure it falls back to a default city center and
   shows a non-blocking notice (fail explicitly, don't show a wrong place
   silently).

   These tests mount the real NearbyHeatView with the native map + expo-image
   stubbed, drive consent (pre-granted in AsyncStorage) and the expo-location
   permission/coords, and assert the camera target AMap receives.

   `@yon/shared` is mapped to its real source in jest.config, so
   `wgs84ToGcj02` here is the SAME conversion the component uses — the test
   pins that the component applies it (raw WGS-84 would fail the assertion).
   ============================================================ */

import TestRenderer, { act } from 'react-test-renderer'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { wgs84ToGcj02 } from '@yon/shared'

// --- Native map: capture the initialCameraPosition AMap is mounted with. ---
const mapMounts: Array<Record<string, unknown>> = []
jest.mock('react-native-amap3d', () => {
  const React = require('react')
  return {
    MapView: (props: Record<string, unknown>) => {
      mapMounts.push(props)
      return React.createElement('MapViewMock', props, props.children as React.ReactNode)
    },
    Polygon: (props: Record<string, unknown>) =>
      React.createElement('PolygonMock', props),
  }
})

jest.mock('expo-image', () => {
  const React = require('react')
  return { Image: (props: Record<string, unknown>) => React.createElement('ImageMock', props) }
})

// SDK init is a native side-effect — stub it.
const mockInitAmap = jest.fn()
jest.mock('@/lib/amapPrivacy', () => ({
  initAmapIfConsented: (...args: unknown[]) => mockInitAmap(...args),
}))

const mockRequestForegroundPermissionsAsync = jest.fn()
const mockGetCurrentPositionAsync = jest.fn()
jest.mock('expo-location', () => ({
  Accuracy: { Balanced: 'balanced', High: 'high' },
  requestForegroundPermissionsAsync: (...args: unknown[]) =>
    mockRequestForegroundPermissionsAsync(...args),
  getCurrentPositionAsync: (...args: unknown[]) => mockGetCurrentPositionAsync(...args),
}))

import NearbyHeatView, { initialCameraFromCoords } from '../NearbyHeatView'

// Shanghai People's Square — must mirror FALLBACK in NearbyHeatView.
const FALLBACK = { lat: 31.2304, lng: 121.4737 }

async function renderView(): Promise<TestRenderer.ReactTestRenderer> {
  let renderer!: TestRenderer.ReactTestRenderer
  // Pre-grant the AMap privacy consent so the map (not the consent gate)
  // mounts, then let the async consent-restore + locate effects drain.
  await AsyncStorage.setItem('yon_amap_consent', 'true')
  await act(async () => {
    renderer = TestRenderer.create(<NearbyHeatView />)
  })
  return renderer
}

function latestCamera(): { target: { latitude: number; longitude: number }; zoom: number } {
  const last = mapMounts[mapMounts.length - 1]
  return last.initialCameraPosition as {
    target: { latitude: number; longitude: number }
    zoom: number
  }
}

describe('initialCameraFromCoords — pure derivation + GCJ-02 conversion', () => {
  it('centers on the user fix, converted WGS-84 → GCJ-02', () => {
    const coords = { lat: 31.2304, lng: 121.4737 }
    const expected = wgs84ToGcj02(coords.lat, coords.lng)
    const out = initialCameraFromCoords(coords)
    expect(out.centered).toBe(true)
    expect(out.camera.target.latitude).toBeCloseTo(expected.lat, 6)
    expect(out.camera.target.longitude).toBeCloseTo(expected.lng, 6)
    // Inside China the conversion MUST shift the coordinate (proves it ran).
    expect(out.camera.target.latitude).not.toBeCloseTo(coords.lat, 6)
  })

  it('falls back to the default city (also GCJ-02) when there is no fix', () => {
    const expected = wgs84ToGcj02(FALLBACK.lat, FALLBACK.lng)
    const out = initialCameraFromCoords(null)
    expect(out.centered).toBe(false)
    expect(out.camera.target.latitude).toBeCloseTo(expected.lat, 6)
    expect(out.camera.target.longitude).toBeCloseTo(expected.lng, 6)
  })
})

describe('NearbyHeatView default-locate on entry (issue #97)', () => {
  let renderer: TestRenderer.ReactTestRenderer | null = null

  beforeEach(async () => {
    jest.clearAllMocks()
    mapMounts.length = 0
    await AsyncStorage.clear()
  })

  afterEach(() => {
    act(() => {
      renderer?.unmount()
    })
    renderer = null
  })

  it('mounts the map centered on the user GPS fix (converted to GCJ-02)', async () => {
    const fix = { lat: 31.2000, lng: 121.5000 }
    mockRequestForegroundPermissionsAsync.mockResolvedValue({ granted: true })
    mockGetCurrentPositionAsync.mockResolvedValue({
      coords: { latitude: fix.lat, longitude: fix.lng },
    })

    renderer = await renderView()

    expect(mapMounts.length).toBeGreaterThan(0)
    const cam = latestCamera()
    const expected = wgs84ToGcj02(fix.lat, fix.lng)
    expect(cam.target.latitude).toBeCloseTo(expected.lat, 5)
    expect(cam.target.longitude).toBeCloseTo(expected.lng, 5)
    // Raw WGS-84 would NOT equal the GCJ-02 target — guards against a missing
    // conversion (the offset bug).
    expect(cam.target.latitude).not.toBeCloseTo(fix.lat, 5)

    // No fallback notice when we have a real fix.
    expect(renderer.root.findAllByProps({ testID: 'nearby-fallback-notice' })).toHaveLength(0)
  })

  it('falls back to the default center + shows a notice when permission is denied', async () => {
    mockRequestForegroundPermissionsAsync.mockResolvedValue({ granted: false })

    renderer = await renderView()

    // getCurrentPositionAsync must never run after a denial.
    expect(mockGetCurrentPositionAsync).not.toHaveBeenCalled()

    expect(mapMounts.length).toBeGreaterThan(0)
    const cam = latestCamera()
    const expected = wgs84ToGcj02(FALLBACK.lat, FALLBACK.lng)
    expect(cam.target.latitude).toBeCloseTo(expected.lat, 5)
    expect(cam.target.longitude).toBeCloseTo(expected.lng, 5)

    // Explicit, non-blocking notice — never show a wrong place silently.
    expect(
      renderer.root.findAllByProps({ testID: 'nearby-fallback-notice' }).length,
    ).toBeGreaterThan(0)
  })
})
