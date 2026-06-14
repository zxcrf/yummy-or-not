/* ============================================================
   Regression tests for NearbyHeatView UI changes
   (feat/nearby-refresh-locate-drop-warn):

   1. 踩雷 (warnBeforeBuy) badge removed from BOTH list cards AND detail sheet.
   2. Refresh button exists, is a safe no-op before first viewport seen, and
      re-fetches the CURRENT viewport — not a stale one captured before a
      non-fetchable zoom-out.
   3. Locate button calls MapView.moveCamera with GCJ-02 converted coords.

   Mount strategy: pre-grant AMap consent in AsyncStorage, stub
   expo-location to grant + return a GPS fix, stub react-native-amap3d.
   geohashCellRectGcj02 is mocked to a deterministic rect so onPress
   hit-testing is predictable without recomputing real projections.
   ============================================================ */

import TestRenderer, { act } from 'react-test-renderer'
import AsyncStorage from '@react-native-async-storage/async-storage'

// ---------- MapView stub: expose moveCamera spy + capture mounts ----------
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

jest.mock('@/lib/amapPrivacy', () => ({ initAmapIfConsented: jest.fn() }))

// ---------- geo API stubs ----------
const mockGetGeoHeat = jest.fn()
const mockGetGeoFeedByCell = jest.fn()

// Return a simple GCJ-02 rect that contains (31.2, 121.5) for hit-testing.
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
    geohashCellRectGcj02: () => MOCK_GCJ02_RECT,
  }
})

// ---------- expo-location: grant + GPS fix ----------
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

const TEST_CELL = 'wtw3s'
const HEAT_PAYLOAD = [{ cell: TEST_CELL, count: 3 }]

// Card with warnBeforeBuy=true — badge must NOT appear after the fix.
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

// ── Helpers ────────────────────────────────────────────────────────────────

async function renderView(): Promise<TestRenderer.ReactTestRenderer> {
  await AsyncStorage.setItem('yon_amap_consent', 'true')
  let renderer!: TestRenderer.ReactTestRenderer
  await act(async () => {
    renderer = TestRenderer.create(<NearbyHeatView />)
  })
  return renderer
}

/** Fire onCameraIdle with the given GCJ-02 bounds (converted to WGS-84 inside
 *  the component). Bounds chosen so decideHeatFetch APPROVES the fetch. */
async function fireFetchableViewport(
  renderer: TestRenderer.ReactTestRenderer,
  sw = { latitude: 31.1, longitude: 121.4 },
  ne = { latitude: 31.3, longitude: 121.6 },
) {
  const mapView = renderer.root.findByType(require('react-native-amap3d').MapView)
  const onCameraIdle = mapView.props.onCameraIdle as (e: unknown) => void
  await act(async () => {
    onCameraIdle({ nativeEvent: { latLngBounds: { southwest: sw, northeast: ne } } })
    await new Promise((r) => setTimeout(r, 400)) // debounce + async loadHeat
  })
}

/** Fire onCameraIdle with a very large viewport that decideHeatFetch will
 *  REJECT (bbox too large → area_too_large guard). */
async function fireNonFetchableViewport(renderer: TestRenderer.ReactTestRenderer) {
  const mapView = renderer.root.findByType(require('react-native-amap3d').MapView)
  const onCameraIdle = mapView.props.onCameraIdle as (e: unknown) => void
  await act(async () => {
    // 80° × 80° — massively oversized, will fail decideHeatFetch.
    onCameraIdle({
      nativeEvent: {
        latLngBounds: {
          southwest: { latitude: -10.0, longitude: 80.0 },
          northeast: { latitude: 70.0, longitude: 160.0 },
        },
      },
    })
    await new Promise((r) => setTimeout(r, 400))
  })
}

/** Tap inside MOCK_GCJ02_RECT to open the cell sheet. */
async function tapMapCell(renderer: TestRenderer.ReactTestRenderer) {
  const mapView = renderer.root.findByType(require('react-native-amap3d').MapView)
  const onPress = mapView.props.onPress as (e: unknown) => void
  await act(async () => {
    onPress({ nativeEvent: { latitude: 31.2, longitude: 121.5 } })
    await new Promise((r) => setTimeout(r, 100))
  })
}

/** Find all nodes whose first text child contains `substr`. */
function findTextNodes(
  renderer: TestRenderer.ReactTestRenderer,
  substr: string,
) {
  return renderer.root.findAll(
    (node) => {
      const t = typeof node.children?.[0] === 'string' ? (node.children[0] as string) : ''
      return t.includes(substr)
    },
    { deep: true },
  )
}

// ── Suite 1: 踩雷 badge removed from list card AND detail sheet ────────────

describe('Change 1 — 踩雷 badge removed', () => {
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

  it('badge absent on list card when warnBeforeBuy=true', async () => {
    mockGetGeoFeedByCell.mockResolvedValue([WARN_CARD])
    renderer = await renderView()
    await fireFetchableViewport(renderer)
    await tapMapCell(renderer)

    expect(mockGetGeoFeedByCell).toHaveBeenCalledWith(TEST_CELL)
    expect(findTextNodes(renderer, '踩雷')).toHaveLength(0)
  })

  it('badge absent on detail sub-sheet when warnBeforeBuy=true', async () => {
    mockGetGeoFeedByCell.mockResolvedValue([WARN_CARD])
    renderer = await renderView()
    await fireFetchableViewport(renderer)
    await tapMapCell(renderer)

    // Open the detail sub-sheet by pressing the card row.
    const cardRow = renderer.root.findByProps({
      accessibilityLabel: `查看 ${WARN_CARD.name} 详情`,
    })
    await act(async () => {
      cardRow.props.onPress()
      await new Promise((r) => setTimeout(r, 50))
    })

    // Detail sheet is open — still no 踩雷 anywhere.
    expect(findTextNodes(renderer, '踩雷')).toHaveLength(0)
  })

  it('回购 N badge still renders when boughtCount > 1', async () => {
    mockGetGeoFeedByCell.mockResolvedValue([{ ...WARN_CARD, boughtCount: 3 }])
    renderer = await renderView()
    await fireFetchableViewport(renderer)
    await tapMapCell(renderer)

    expect(mockGetGeoFeedByCell).toHaveBeenCalledWith(TEST_CELL)
    expect(findTextNodes(renderer, '回购')).not.toHaveLength(0)
  })
})

// ── Suite 2a: Refresh — safe no-op before first viewport ──────────────────

describe('Change 2a — Refresh: safe no-op before first viewport seen', () => {
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

  it('pressing Refresh before any camera-idle event does not crash or fetch', async () => {
    renderer = await renderView()
    // No fireFetchableViewport / fireNonFetchableViewport — bbox is null.

    const refreshBtn = renderer.root.findByProps({ testID: 'nearby-refresh-btn' })
    await act(async () => {
      refreshBtn.props.onPress()
      await new Promise((r) => setTimeout(r, 50))
    })

    // getGeoHeat must NOT have been called (no viewport stored yet).
    expect(mockGetGeoHeat).not.toHaveBeenCalled()
  })
})

// ── Suite 2b: Refresh fetches CURRENT viewport after non-fetchable zoom-out ─

describe('Change 2b — Refresh fetches current viewport (stale-bbox regression)', () => {
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

  it('Refresh after non-fetchable viewport re-fetches the current (non-fetchable) bbox directly — not the previous fetchable one', async () => {
    renderer = await renderView()

    // Step 1: fetchable viewport — loadHeat runs and getGeoHeat is called once.
    await fireFetchableViewport(renderer)
    const callsAfterFetchable = mockGetGeoHeat.mock.calls.length
    expect(callsAfterFetchable).toBeGreaterThan(0)

    // Capture the bbox sent for the first fetchable viewport.
    const firstCallBbox = mockGetGeoHeat.mock.calls[0][0] as Record<string, number>

    // Step 2: zoom out to a non-fetchable viewport. decideHeatFetch blocks the
    // auto-fetch, so getGeoHeat is NOT called again automatically.
    await fireNonFetchableViewport(renderer)
    expect(mockGetGeoHeat.mock.calls.length).toBe(callsAfterFetchable) // still same count

    // Step 3: explicit Refresh. Must call getGeoHeat with the NON-FETCHABLE
    // (current) viewport bbox — NOT the old fetchable one from step 1.
    const refreshBtn = renderer.root.findByProps({ testID: 'nearby-refresh-btn' })
    await act(async () => {
      refreshBtn.props.onPress()
      await new Promise((r) => setTimeout(r, 100))
    })

    expect(mockGetGeoHeat.mock.calls.length).toBeGreaterThan(callsAfterFetchable)

    // The bbox sent to getGeoHeat on Refresh must differ from the old fetchable
    // one — proving it used the CURRENT (non-fetchable) viewport, not the stale one.
    const refreshCallBbox = mockGetGeoHeat.mock.calls[callsAfterFetchable][0] as Record<string, number>
    expect(refreshCallBbox).not.toEqual(firstCallBbox)
  })
})

// ── Suite 2c: Refresh re-fetches after a normal fetchable viewport ─────────

describe('Change 2c — Refresh re-fetches after normal viewport', () => {
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

  it('Refresh button exists and re-fetches heat data on press', async () => {
    renderer = await renderView()
    await fireFetchableViewport(renderer)

    const callsBefore = mockGetGeoHeat.mock.calls.length
    expect(callsBefore).toBeGreaterThan(0)

    const refreshBtn = renderer.root.findByProps({ testID: 'nearby-refresh-btn' })
    expect(refreshBtn).toBeTruthy()

    await act(async () => {
      refreshBtn.props.onPress()
      await new Promise((r) => setTimeout(r, 100))
    })

    expect(mockGetGeoHeat.mock.calls.length).toBeGreaterThan(callsBefore)
  })
})

// ── Suite 3: Locate button calls moveCamera with GCJ-02 coords ────────────

describe('Change 3 — Locate button triggers GCJ-02 moveCamera', () => {
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

    // Target is GCJ-02 converted — not raw WGS-84.
    expect(cameraArg.target.latitude).toBeCloseTo(expected.lat, 5)
    expect(cameraArg.target.longitude).toBeCloseTo(expected.lng, 5)

    // Inside China GCJ-02 ≠ WGS-84 — proves conversion ran.
    expect(cameraArg.target.latitude).not.toBeCloseTo(GPS_FIX.lat, 5)
  })
})
