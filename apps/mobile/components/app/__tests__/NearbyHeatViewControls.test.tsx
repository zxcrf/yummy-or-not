/* ============================================================
   Regression tests for NearbyHeatView UI changes (feat/nearby-refresh-locate-drop-warn):
   1. 踩雷 (warnBeforeBuy) badge is NOT rendered on geo-feed cards
      (removed as overkill for the coarsened nearby view — RED vs #108 code).
   2. Refresh button exists and invokes getGeoHeat on press.
   3. Locate button exists and calls MapView.moveCamera with GCJ-02 coords.

   Mount strategy mirrors NearbyHeatViewLocate.test.tsx: pre-grant AMap
   consent in AsyncStorage, stub expo-location to grant + return a fix,
   stub react-native-amap3d MapView/Polygon.

   geohashCellRectGcj02 is mocked to return a simple known GCJ-02 rect so
   that the onPress hit-test is deterministic without needing to recompute
   the real WGS-84→GCJ-02 projection for each test cell.
   ============================================================ */

import TestRenderer, { act } from 'react-test-renderer'
import AsyncStorage from '@react-native-async-storage/async-storage'

// ---------- MapView stub: capture initialCameraPosition + expose moveCamera spy ----------
const mockMoveCamera = jest.fn()
const mapMounts: Array<Record<string, unknown>> = []

jest.mock('react-native-amap3d', () => {
  const React = require('react')
  class MapViewMock extends React.Component<Record<string, unknown>> {
    moveCamera = mockMoveCamera
    render() {
      mapMounts.push(this.props)
      return React.createElement('MapViewMock', this.props, this.props.children as React.ReactNode)
    }
  }
  return {
    MapView: MapViewMock,
    Polygon: (props: Record<string, unknown>) =>
      React.createElement('PolygonMock', props),
  }
})

jest.mock('expo-image', () => {
  const React = require('react')
  return { Image: (props: Record<string, unknown>) => React.createElement('ImageMock', props) }
})

jest.mock('@/lib/amapPrivacy', () => ({
  initAmapIfConsented: jest.fn(),
}))

// ---------- geo API stubs ----------
const mockGetGeoHeat = jest.fn()
const mockGetGeoFeedByCell = jest.fn()

// Known GCJ-02 rect returned for every cell — chosen so the tap point
// { latitude: 31.2, longitude: 121.5 } falls inside it.
const MOCK_GCJ02_RECT = [
  { latitude: 31.1, longitude: 121.4 },
  { latitude: 31.1, longitude: 121.6 },
  { latitude: 31.3, longitude: 121.6 },
  { latitude: 31.3, longitude: 121.4 },
]

jest.mock('@yon/shared', () => {
  const actual = jest.requireActual('@yon/shared')
  return {
    ...actual,
    getGeoHeat: (...args: unknown[]) => mockGetGeoHeat(...args),
    getGeoFeedByCell: (...args: unknown[]) => mockGetGeoFeedByCell(...args),
    // Return a simple known rect so onPress hit-testing is deterministic.
    geohashCellRectGcj02: () => MOCK_GCJ02_RECT,
  }
})

// ---------- expo-location stub: grant + return a WGS-84 fix ----------
const GPS_FIX = { lat: 31.2, lng: 121.5 }

jest.mock('expo-location', () => ({
  Accuracy: { Balanced: 'balanced' },
  requestForegroundPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }),
  getCurrentPositionAsync: jest.fn().mockResolvedValue({
    coords: { latitude: GPS_FIX.lat, longitude: GPS_FIX.lng },
  }),
}))

import NearbyHeatView from '../NearbyHeatView'
import { wgs84ToGcj02 } from '@yon/shared'

// Test cell + heat payload
const TEST_CELL = 'wtw3s'
const HEAT_PAYLOAD = [{ cell: TEST_CELL, count: 3 }]

// A GeoFeedCard with warnBeforeBuy=true — the 踩雷 badge must NOT appear after the fix.
const WARN_CARD = {
  id: 'card-warn',
  name: '测试小吃',
  verdict: 'nah',
  image: null,
  imageThumb: null,
  imageDisplay: null,
  tags: ['辣'],
  boughtCount: 1,
  warnBeforeBuy: true,
}

// Simulate a camera-idle event to trigger loadHeat → stores lastBboxRef.
// Uses a viewport that passes decideHeatFetch's area check.
async function fireCameraIdle(renderer: TestRenderer.ReactTestRenderer) {
  const mapView = renderer.root.findByType(
    require('react-native-amap3d').MapView,
  )
  const onCameraIdle = mapView.props.onCameraIdle as (e: unknown) => void
  await act(async () => {
    onCameraIdle({
      nativeEvent: {
        latLngBounds: {
          southwest: { latitude: 31.1, longitude: 121.4 },
          northeast: { latitude: 31.3, longitude: 121.6 },
        },
      },
    })
    await new Promise((r) => setTimeout(r, 400))
  })
}

// Tap the map at a coordinate inside MOCK_GCJ02_RECT to open the cell sheet.
async function tapMapCell(renderer: TestRenderer.ReactTestRenderer) {
  const mapView = renderer.root.findByType(
    require('react-native-amap3d').MapView,
  )
  const onPress = mapView.props.onPress as (e: unknown) => void
  await act(async () => {
    // This point is inside MOCK_GCJ02_RECT (31.1–31.3, 121.4–121.6).
    onPress({ nativeEvent: { latitude: 31.2, longitude: 121.5 } })
    await new Promise((r) => setTimeout(r, 100))
  })
}

async function renderView(): Promise<TestRenderer.ReactTestRenderer> {
  await AsyncStorage.setItem('yon_amap_consent', 'true')
  let renderer!: TestRenderer.ReactTestRenderer
  await act(async () => {
    renderer = TestRenderer.create(<NearbyHeatView />)
  })
  return renderer
}

// ─── Suite 1: 踩雷 badge removed ────────────────────────────────────────────

describe('Change 1 — 踩雷 (warnBeforeBuy) badge removed from geo-feed cards', () => {
  let renderer: TestRenderer.ReactTestRenderer | null = null

  beforeEach(async () => {
    jest.clearAllMocks()
    mapMounts.length = 0
    await AsyncStorage.clear()
    mockGetGeoHeat.mockResolvedValue(HEAT_PAYLOAD)
  })

  afterEach(() => {
    act(() => { renderer?.unmount() })
    renderer = null
  })

  it('does NOT render the ⚠️ 踩雷 badge even when warnBeforeBuy=true on a card', async () => {
    mockGetGeoFeedByCell.mockResolvedValue([WARN_CARD])
    renderer = await renderView()
    await fireCameraIdle(renderer)
    await tapMapCell(renderer)

    // Sheet should be open — getGeoFeedByCell was called
    expect(mockGetGeoFeedByCell).toHaveBeenCalledWith(TEST_CELL)

    // No element in the tree should contain '踩雷'
    const warnElements = renderer.root.findAll(
      (node) => {
        const text = typeof node.children?.[0] === 'string' ? node.children[0] as string : ''
        return text.includes('踩雷')
      },
      { deep: true },
    )
    expect(warnElements).toHaveLength(0)
  })

  it('still renders 回购 N badge when boughtCount > 1 (boughtCount kept)', async () => {
    mockGetGeoFeedByCell.mockResolvedValue([{ ...WARN_CARD, boughtCount: 3 }])
    renderer = await renderView()
    await fireCameraIdle(renderer)
    await tapMapCell(renderer)

    expect(mockGetGeoFeedByCell).toHaveBeenCalledWith(TEST_CELL)

    // 回购 3 badge should appear
    const boughtBadges = renderer.root.findAll(
      (node) => {
        const text = typeof node.children?.[0] === 'string' ? node.children[0] as string : ''
        return text.includes('回购')
      },
      { deep: true },
    )
    expect(boughtBadges.length).toBeGreaterThan(0)
  })
})

// ─── Suite 2: Refresh button ─────────────────────────────────────────────────

describe('Change 2a — Refresh button invokes getGeoHeat on press', () => {
  let renderer: TestRenderer.ReactTestRenderer | null = null

  beforeEach(async () => {
    jest.clearAllMocks()
    mapMounts.length = 0
    await AsyncStorage.clear()
    mockGetGeoHeat.mockResolvedValue(HEAT_PAYLOAD)
    mockGetGeoFeedByCell.mockResolvedValue([])
  })

  afterEach(() => {
    act(() => { renderer?.unmount() })
    renderer = null
  })

  it('refresh button exists and re-fetches heat data on press', async () => {
    renderer = await renderView()
    await fireCameraIdle(renderer)

    // camera-idle already triggered one getGeoHeat call
    const callsBefore = mockGetGeoHeat.mock.calls.length
    expect(callsBefore).toBeGreaterThan(0)

    const refreshBtn = renderer.root.findByProps({ testID: 'nearby-refresh-btn' })
    expect(refreshBtn).toBeTruthy()

    await act(async () => {
      refreshBtn.props.onPress()
      await new Promise((r) => setTimeout(r, 50))
    })

    // getGeoHeat must have been called at least once more
    expect(mockGetGeoHeat.mock.calls.length).toBeGreaterThan(callsBefore)
  })
})

// ─── Suite 3: Locate button ───────────────────────────────────────────────────

describe('Change 2b — Locate button triggers moveCamera to GCJ-02 user position', () => {
  let renderer: TestRenderer.ReactTestRenderer | null = null

  beforeEach(async () => {
    jest.clearAllMocks()
    mapMounts.length = 0
    await AsyncStorage.clear()
    mockGetGeoHeat.mockResolvedValue(HEAT_PAYLOAD)
    mockGetGeoFeedByCell.mockResolvedValue([])
  })

  afterEach(() => {
    act(() => { renderer?.unmount() })
    renderer = null
  })

  it('locate button exists and calls MapView.moveCamera with GCJ-02 converted coords', async () => {
    renderer = await renderView()

    const locateBtn = renderer.root.findByProps({ testID: 'nearby-locate-btn' })
    expect(locateBtn).toBeTruthy()

    await act(async () => {
      locateBtn.props.onPress()
    })

    expect(mockMoveCamera).toHaveBeenCalled()

    const [cameraArg] = mockMoveCamera.mock.calls[0] as [
      { target: { latitude: number; longitude: number }; zoom: number },
      number,
    ]
    const expected = wgs84ToGcj02(GPS_FIX.lat, GPS_FIX.lng)

    // Target must be the GCJ-02-converted GPS fix, not raw WGS-84.
    expect(cameraArg.target.latitude).toBeCloseTo(expected.lat, 5)
    expect(cameraArg.target.longitude).toBeCloseTo(expected.lng, 5)

    // Inside China, GCJ-02 ≠ WGS-84 — proves the conversion ran.
    expect(cameraArg.target.latitude).not.toBeCloseTo(GPS_FIX.lat, 5)
  })
})
