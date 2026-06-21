/* ============================================================
   Mount tests — the REAL Android map host (LocationPickerHost.android.tsx).

   The host owns the single, app-root AMap map. The headline behaviour this pins
   is NEVER UNMOUNTING the native MapView: react-native-amap3d crashes the app
   when its MapView is destroyed, so closing the picker must only HIDE the map
   (display:none), never unmount it. The suite mounts the real component with the
   native map / SDK / GPS stubbed and asserts that, plus the consent gate, the
   WGS-84↔GCJ-02 camera conversion, picking, debounced reverse-geocode, safe-area
   header, and hardware-back handling.
   ============================================================ */

import TestRenderer, { act } from 'react-test-renderer'
import { BackHandler } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { wgs84ToGcj02, gcj02ToWgs84, reverseGeocode } from '@yon/shared'

// --- Native map: capture mount props + count mounts/unmounts of the MapView. ---
const mapMounts: Array<Record<string, unknown>> = []
const mapLifecycle = { mounts: 0, unmounts: 0 }
const mockMoveCamera = jest.fn()
jest.mock('react-native-amap3d', () => {
  const React = require('react')
  class MapView extends React.Component {
    moveCamera = (...args: unknown[]) => mockMoveCamera(...args)
    componentDidMount() { mapLifecycle.mounts += 1 }
    componentWillUnmount() { mapLifecycle.unmounts += 1 }
    render() {
      mapMounts.push(this.props as Record<string, unknown>)
      return React.createElement('MapViewMock', this.props, (this.props as { children?: unknown }).children)
    }
  }
  return { MapView, Marker: (p: Record<string, unknown>) => React.createElement('MarkerMock', p) }
})

const TOP_INSET = 100
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: TOP_INSET, bottom: 0, left: 0, right: 0 }),
}))

const mockInitAmap = jest.fn()
jest.mock('@/lib/amapPrivacy', () => ({ initAmapIfConsented: (...a: unknown[]) => mockInitAmap(...a) }))

const mockRequestLocate = jest.fn()
jest.mock('@/app/(tabs)/_useUserCoords', () => ({ requestLocateResult: (...a: unknown[]) => mockRequestLocate(...a) }))

jest.mock('@yon/shared', () => {
  const actual = jest.requireActual('@yon/shared')
  return { ...actual, reverseGeocode: jest.fn() }
})

jest.mock('@/providers/I18nProvider', () => ({ useI18n: () => ({ t: (k: string) => k }) }))
jest.mock('@/components/ds', () => {
  const React = require('react')
  return {
    Button: ({ children, ...p }: { children?: React.ReactNode }) => React.createElement('Button', p, children),
    Card: ({ children, ...p }: { children?: React.ReactNode }) => React.createElement('Card', p, children),
    Icon: (p: Record<string, unknown>) => React.createElement('Icon', p),
  }
})

import LocationPickerHost from '../LocationPickerHost.android'
import { type LatLng } from '@/lib/locationPicker'
import { Modal } from 'react-native'

const mockReverse = reverseGeocode as jest.Mock
const CONSENT_KEY = 'yon_amap_consent'
const PICK_ZOOM = 16
const REVERSE_DEBOUNCE_MS = 500
const CHINA: LatLng = { lat: 31.2304, lng: 121.4737 }

const mounted: TestRenderer.ReactTestRenderer[] = []
let backPressHandlers: Array<() => boolean> = []

interface Props {
  visible?: boolean
  initial?: LatLng | null
  keepMounted?: boolean
  onCancel?: () => void
  onConfirm?: (c: LatLng, p: string | null) => void
}
function el(props: Props) {
  return (
    <LocationPickerHost
      visible={props.visible ?? true}
      initial={props.initial ?? null}
      keepMounted={props.keepMounted ?? true}
      onCancel={props.onCancel ?? (() => {})}
      onConfirm={props.onConfirm ?? (() => {})}
    />
  )
}
async function renderHost(props: Props = {}): Promise<TestRenderer.ReactTestRenderer> {
  let renderer!: TestRenderer.ReactTestRenderer
  await act(async () => { renderer = TestRenderer.create(el(props)) })
  mounted.push(renderer)
  return renderer
}
function byId(r: TestRenderer.ReactTestRenderer, id: string) {
  return r.root.findAllByProps({ testID: id })[0]
}
function latestCamera() {
  return mapMounts[mapMounts.length - 1].initialCameraPosition as {
    target: { latitude: number; longitude: number }; zoom: number
  }
}
async function settleCameraAt(gcj: { lat: number; lng: number }) {
  const onCameraIdle = mapMounts[mapMounts.length - 1].onCameraIdle as (e: unknown) => void
  await act(async () => {
    onCameraIdle({ nativeEvent: { cameraPosition: { target: { latitude: gcj.lat, longitude: gcj.lng } } } })
  })
}

describe('LocationPickerHost.android', () => {
  beforeEach(async () => {
    jest.clearAllMocks()
    mapMounts.length = 0
    mapLifecycle.mounts = 0
    mapLifecycle.unmounts = 0
    backPressHandlers = []
    jest.spyOn(BackHandler, 'addEventListener').mockImplementation(((_e: string, cb: () => boolean) => {
      backPressHandlers.push(cb)
      return { remove: jest.fn() }
    }) as never)
    await AsyncStorage.clear()
    mockReverse.mockResolvedValue({ place: 'Resolved Address' })
    mockRequestLocate.mockResolvedValue({ coords: { lat: 31.2, lng: 121.5 }, status: 'ok' })
  })
  afterEach(() => {
    act(() => { mounted.forEach((r) => r.unmount()) })
    mounted.length = 0
  })

  it('renders nothing until the picker has been opened (keepMounted=false)', async () => {
    await AsyncStorage.setItem(CONSENT_KEY, 'true')
    const renderer = await renderHost({ keepMounted: false, visible: false })
    expect(renderer.toJSON()).toBeNull()
    expect(mapLifecycle.mounts).toBe(0)
  })

  describe('consent gate', () => {
    it('does not mount the map until consent is granted, then mounts on agree', async () => {
      const renderer = await renderHost({ initial: CHINA })
      expect(mapMounts).toHaveLength(0)
      expect(mockInitAmap).not.toHaveBeenCalled()

      await act(async () => { await byId(renderer, 'loc-picker-consent-agree').props.onPress() })

      expect(mockInitAmap).toHaveBeenCalledWith(true)
      expect(await AsyncStorage.getItem(CONSENT_KEY)).toBe('true')
      expect(mapLifecycle.mounts).toBe(1)
    })

    it('mounts the map straight away when consent was previously granted', async () => {
      await AsyncStorage.setItem(CONSENT_KEY, 'true')
      await renderHost({ initial: CHINA })
      expect(mockInitAmap).toHaveBeenCalledWith(true)
      expect(mapLifecycle.mounts).toBe(1)
    })
  })

  // The headline regression: closing the picker must NOT unmount the map.
  describe('never unmounts the map (crash fix)', () => {
    beforeEach(async () => { await AsyncStorage.setItem(CONSENT_KEY, 'true') })

    it('keeps the MapView mounted across close + reopen (no destroy → no crash)', async () => {
      const renderer = await renderHost({ visible: true, initial: CHINA })
      expect(mapLifecycle.mounts).toBe(1)
      expect(mapLifecycle.unmounts).toBe(0)

      // Close the picker (request → null): overlay hides but the map stays mounted.
      await act(async () => { renderer.update(el({ visible: false, keepMounted: true, initial: null })) })
      expect(mapLifecycle.unmounts).toBe(0)
      expect(mapLifecycle.mounts).toBe(1)
      // Overlay is hidden via display:none, not torn down.
      const overlay = byId(renderer, 'loc-picker-overlay')
      expect((require('react-native').StyleSheet.flatten(overlay.props.style) as { display?: string }).display).toBe('none')

      // Reopen — still the same single mount, no remount.
      await act(async () => { renderer.update(el({ visible: true, keepMounted: true, initial: { lat: 39.9, lng: 116.4 } })) })
      expect(mapLifecycle.mounts).toBe(1)
      expect(mapLifecycle.unmounts).toBe(0)
    })

    it('is shown (display:flex) while open', async () => {
      const renderer = await renderHost({ visible: true, initial: CHINA })
      const overlay = byId(renderer, 'loc-picker-overlay')
      expect((require('react-native').StyleSheet.flatten(overlay.props.style) as { display?: string }).display).toBe('flex')
    })
  })

  describe('camera + picking', () => {
    beforeEach(async () => { await AsyncStorage.setItem(CONSENT_KEY, 'true') })

    it('opens centered on the seed, converted WGS-84 → GCJ-02, at PICK_ZOOM', async () => {
      await renderHost({ initial: CHINA })
      const cam = latestCamera()
      const expected = wgs84ToGcj02(CHINA.lat, CHINA.lng)
      expect(cam.zoom).toBe(PICK_ZOOM)
      expect(cam.target.latitude).toBeCloseTo(expected.lat, 6)
      expect(cam.target.latitude).not.toBeCloseTo(CHINA.lat, 6)
    })

    it('confirms WGS-84 coords from the GCJ-02 camera center; Confirm gated on a pin', async () => {
      const onConfirm = jest.fn()
      const renderer = await renderHost({ initial: null, onConfirm })
      expect(byId(renderer, 'loc-picker-confirm').props.disabled).toBe(true)

      const gcj = wgs84ToGcj02(CHINA.lat, CHINA.lng)
      await settleCameraAt(gcj)
      expect(byId(renderer, 'loc-picker-confirm').props.disabled).toBe(false)

      await act(async () => { byId(renderer, 'loc-picker-confirm').props.onPress() })
      const [coords] = onConfirm.mock.calls[0]
      const expected = gcj02ToWgs84(gcj.lat, gcj.lng)
      expect(coords.lat).toBeCloseTo(expected.lat, 6)
      expect(coords.lat).toBeCloseTo(CHINA.lat, 4)
      expect(coords.lat).not.toBeCloseTo(gcj.lat, 6)
    })

    it('reverse-geocodes the picked center (WGS-84) after the debounce', async () => {
      mockReverse.mockResolvedValue({ place: 'Tiger Sugar' })
      const renderer = await renderHost({ initial: null })
      const gcj = wgs84ToGcj02(CHINA.lat, CHINA.lng)
      await settleCameraAt(gcj)
      await act(async () => { await new Promise((r) => setTimeout(r, REVERSE_DEBOUNCE_MS + 50)) })

      const [rlat, rlng] = mockReverse.mock.calls[0]
      expect(rlat).toBeCloseTo(CHINA.lat, 4)
      expect(rlng).toBeCloseTo(CHINA.lng, 4)
      expect(byId(renderer, 'loc-picker-address').props.children).toBe('Tiger Sugar')
    })

    it('survives a reverse-geocode failure — coords still confirm, address null', async () => {
      mockReverse.mockRejectedValue(new Error('net'))
      const onConfirm = jest.fn()
      const renderer = await renderHost({ initial: CHINA, onConfirm })
      await settleCameraAt(wgs84ToGcj02(CHINA.lat, CHINA.lng))
      await act(async () => { await new Promise((r) => setTimeout(r, REVERSE_DEBOUNCE_MS + 50)) })
      await act(async () => { byId(renderer, 'loc-picker-confirm').props.onPress() })
      const [coords, place] = onConfirm.mock.calls[0]
      expect(coords.lat).toBeCloseTo(CHINA.lat, 4)
      expect(place).toBeNull()
    })
  })

  describe('chrome (safe area, back, dismiss)', () => {
    beforeEach(async () => { await AsyncStorage.setItem(CONSENT_KEY, 'true') })

    it('pads the header by the top safe-area inset', async () => {
      const renderer = await renderHost({ initial: CHINA })
      const flat = require('react-native').StyleSheet.flatten(byId(renderer, 'loc-picker-header').props.style) as { paddingTop: number }
      expect(flat.paddingTop).toBeGreaterThanOrEqual(TOP_INSET)
    })

    it('never wraps the map in a React Native <Modal>', async () => {
      const renderer = await renderHost({ initial: CHINA })
      expect(renderer.root.findAllByType(Modal)).toHaveLength(0)
    })

    it('handles hardware-back by closing (onCancel) and consuming the event', async () => {
      const onCancel = jest.fn()
      await renderHost({ initial: CHINA, onCancel })
      expect(backPressHandlers.length).toBeGreaterThan(0)
      const handled = backPressHandlers[backPressHandlers.length - 1]()
      expect(onCancel).toHaveBeenCalledTimes(1)
      expect(handled).toBe(true)
    })

    it('fires onCancel from the header dismiss', async () => {
      const onCancel = jest.fn()
      const renderer = await renderHost({ initial: CHINA, onCancel })
      await act(async () => { byId(renderer, 'loc-picker-cancel').props.onPress() })
      expect(onCancel).toHaveBeenCalledTimes(1)
    })
  })
})
