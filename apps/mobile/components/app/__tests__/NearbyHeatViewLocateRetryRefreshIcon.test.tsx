/* ============================================================
   RED regression — Bug 3 (dead locate button) + Bug 2 (wrong refresh icon)
   on 附近·热力 (NearbyHeatView).

   Bug 3 — 定位按钮按了没反应 after a failed locate.
     NearbyHeatView.tsx:287 — handleLocate does `if (!locate.coords) return`.
     The one-shot useLocateResult only fires on [enabled]; once the initial
     locate FAILS (coords null), the button is a permanent no-op: it can never
     move the camera AND never re-attempts a locate. The user is stuck on the
     fallback city with a dead button.
     RED test: mount with the initial locate FAILED (getCurrentPositionAsync
     rejects, no last-known), press the locate button → assert it ATTEMPTS a
     FRESH locate (calls a position source again). Current code: silent no-op,
     so no fresh call happens → FAILS.

   Bug 2 — 刷新按钮图标错 (literal up-arrow ↑).
     NearbyHeatView.tsx:423 — the refresh button renders <Icon name="arrow-up" />
     because no refresh glyph exists in icon-paths.ts yet.
     RED test: the refresh button must NOT use the "arrow-up" icon; it must use
     the agreed refresh glyph name "refresh". Current code: name is "arrow-up"
     → FAILS. (The fix adds the "refresh" glyph to icon-paths.ts + assets.)

   Harness mirrors NearbyHeatViewControls.test.tsx: pre-grant AMap consent,
   stub react-native-amap3d + expo-image + amapPrivacy + the geo API, and
   mock expo-location.
   ============================================================ */

import TestRenderer, { act } from 'react-test-renderer'
import AsyncStorage from '@react-native-async-storage/async-storage'

// ---------- MapView stub: expose moveCamera spy ----------
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
    Polygon: (props: Record<string, unknown>) => React.createElement('PolygonMock', props),
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

jest.mock('@yon/shared', () => {
  const actual = jest.requireActual('@yon/shared')
  return {
    ...actual,
    getGeoHeat: (...args: unknown[]) => mockGetGeoHeat(...args),
    getGeoFeedByCell: (...args: unknown[]) => mockGetGeoFeedByCell(...args),
  }
})

// ---------- expo-location: permission granted, but the live fix FAILS ----------
const mockRequestPerm = jest.fn()
const mockGetCurrentPosition = jest.fn()
const mockGetLastKnown = jest.fn()

jest.mock('expo-location', () => ({
  Accuracy: { Balanced: 'balanced', High: 'high' },
  requestForegroundPermissionsAsync: (...args: unknown[]) => mockRequestPerm(...args),
  getCurrentPositionAsync: (...args: unknown[]) => mockGetCurrentPosition(...args),
  getLastKnownPositionAsync: (...args: unknown[]) => mockGetLastKnown(...args),
}))

import NearbyHeatView from '../NearbyHeatView'

const HEAT_PAYLOAD = [{ cell: 'wtw3s', count: 3 }]

async function renderView(): Promise<TestRenderer.ReactTestRenderer> {
  await AsyncStorage.setItem('yon_amap_consent', 'true')
  let renderer!: TestRenderer.ReactTestRenderer
  await act(async () => {
    renderer = TestRenderer.create(<NearbyHeatView />)
  })
  return renderer
}

/** The <Icon> rendered inside a control Pressable identified by testID.
 *  The DS Icon is the only descendant carrying a string `name` prop. */
function controlIcon(
  renderer: TestRenderer.ReactTestRenderer,
  testID: string,
): TestRenderer.ReactTestInstance {
  const btn = renderer.root.findByProps({ testID })
  const icons = btn.findAll(
    (node) => typeof node.props?.name === 'string',
    { deep: true },
  )
  if (icons.length === 0) throw new Error(`No icon with a name prop inside ${testID}`)
  return icons[0]!
}

// ── Bug 3: locate button re-attempts a fresh locate after a failed locate ──

describe('Bug 3 — locate button is not dead after a failed initial locate', () => {
  let renderer: TestRenderer.ReactTestRenderer | null = null

  beforeEach(async () => {
    jest.clearAllMocks()
    mapMounts.length = 0
    await AsyncStorage.clear()
    mockGetGeoHeat.mockResolvedValue(HEAT_PAYLOAD)
    mockGetGeoFeedByCell.mockResolvedValue([])
    mockRequestPerm.mockResolvedValue({ granted: true })
    // Initial locate fails: cold GPS, no cached fix → status 'failed', coords null.
    mockGetCurrentPosition.mockRejectedValue(new Error('timeout'))
    mockGetLastKnown.mockResolvedValue(null)
  })

  afterEach(() => {
    act(() => { renderer?.unmount() })
    renderer = null
  })

  it('pressing locate after a failed initial locate attempts a FRESH locate (not a silent no-op)', async () => {
    renderer = await renderView()

    // Initial mount locate has already run and failed. Reset the position-source
    // call counts so we measure ONLY what the button press triggers.
    mockGetCurrentPosition.mockClear()
    mockGetLastKnown.mockClear()
    mockMoveCamera.mockClear()

    // Now a fix becomes available (user moved outdoors / GPS warmed up).
    mockGetLastKnown.mockResolvedValue({ coords: { latitude: 31.2, longitude: 121.5 } })
    mockGetCurrentPosition.mockResolvedValue({ coords: { latitude: 31.2, longitude: 121.5 } })

    const locateBtn = renderer.root.findByProps({ testID: 'nearby-locate-btn' })
    await act(async () => {
      await locateBtn.props.onPress()
      await new Promise((r) => setTimeout(r, 50))
    })

    // The fix must re-attempt acquiring a position. Current code returns early
    // (coords is null) and touches NEITHER source → this assertion FAILS.
    const freshAttempt =
      mockGetCurrentPosition.mock.calls.length + mockGetLastKnown.mock.calls.length
    expect(freshAttempt).toBeGreaterThan(0)
  })
})

// ── Bug 1: fallback banner clears after a SUCCESSFUL manual locate ─────────

/** True when any rendered text node contains the given substring. The banner
 *  text is composed from several string children, so flatten them first. */
function treeHasText(
  renderer: TestRenderer.ReactTestRenderer,
  needle: string,
): boolean {
  const nodes = renderer.root.findAll(
    (node) => {
      const c = node.props?.children
      const flat = Array.isArray(c) ? c.join('') : c
      return typeof flat === 'string' && flat.includes(needle)
    },
    { deep: true },
  )
  return nodes.length > 0
}

describe('Bug 1 — "定位失败" fallback banner clears after a successful manual locate', () => {
  let renderer: TestRenderer.ReactTestRenderer | null = null

  beforeEach(async () => {
    jest.clearAllMocks()
    mapMounts.length = 0
    await AsyncStorage.clear()
    mockGetGeoHeat.mockResolvedValue(HEAT_PAYLOAD)
    mockGetGeoFeedByCell.mockResolvedValue([])
    mockRequestPerm.mockResolvedValue({ granted: true })
    // Initial locate fails: cold GPS, no cached fix → status 'failed', coords null.
    mockGetCurrentPosition.mockRejectedValue(new Error('timeout'))
    mockGetLastKnown.mockResolvedValue(null)
  })

  afterEach(() => {
    act(() => { renderer?.unmount() })
    renderer = null
  })

  it('removes the "定位失败" banner once a retry locate succeeds (not a stale contradiction)', async () => {
    renderer = await renderView()

    // Precondition: the initial locate failed → the fallback banner is showing.
    expect(treeHasText(renderer, '定位失败')).toBe(true)

    // A fix now becomes available (GPS warmed up / user moved outdoors).
    mockGetCurrentPosition.mockResolvedValue({ coords: { latitude: 31.2, longitude: 121.5 } })
    mockGetLastKnown.mockResolvedValue({ coords: { latitude: 31.2, longitude: 121.5 } })
    mockMoveCamera.mockClear()

    const locateBtn = renderer.root.findByProps({ testID: 'nearby-locate-btn' })
    await act(async () => {
      await locateBtn.props.onPress()
      await new Promise((r) => setTimeout(r, 50))
    })

    // The camera should have moved to the fresh fix (GCJ-02-converted).
    expect(mockMoveCamera).toHaveBeenCalled()

    // The successful retry must write the result back to locate state so the
    // fallback banner clears. Current code only moves the camera and discards
    // the LocateResult → initial.centered stays false → banner stays → FAILS.
    expect(treeHasText(renderer, '定位失败')).toBe(false)
    expect(treeHasText(renderer, '已显示默认城市')).toBe(false)
  })
})

// ── Bug 2: refresh button uses a refresh glyph, not the up-arrow ──────────

describe('Bug 2 — refresh button icon is "refresh", not "arrow-up"', () => {
  let renderer: TestRenderer.ReactTestRenderer | null = null

  beforeEach(async () => {
    jest.clearAllMocks()
    mapMounts.length = 0
    await AsyncStorage.clear()
    mockGetGeoHeat.mockResolvedValue(HEAT_PAYLOAD)
    mockGetGeoFeedByCell.mockResolvedValue([])
    mockRequestPerm.mockResolvedValue({ granted: true })
    // A clean fix so the map (not the locating spinner) mounts.
    mockGetCurrentPosition.mockResolvedValue({ coords: { latitude: 31.2, longitude: 121.5 } })
    mockGetLastKnown.mockResolvedValue({ coords: { latitude: 31.2, longitude: 121.5 } })
  })

  afterEach(() => {
    act(() => { renderer?.unmount() })
    renderer = null
  })

  it('renders the refresh button with a refresh/reload glyph, never the literal up-arrow', async () => {
    renderer = await renderView()

    const icon = controlIcon(renderer, 'nearby-refresh-btn')

    // Current code: name === 'arrow-up' (no refresh glyph exists yet) → FAILS.
    expect(icon.props.name).not.toBe('arrow-up')
    expect(icon.props.name).toBe('refresh')
  })
})
