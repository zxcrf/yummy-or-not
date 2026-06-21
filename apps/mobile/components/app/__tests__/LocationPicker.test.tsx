/* ============================================================
   Mount tests — the REAL Android map picker (LocationPicker.android.tsx).

   jest resolves `./LocationPicker` to the non-Android stub, so the shipped
   Android component (consent gate, camera-idle → pin, debounced reverse-geocode,
   confirm/cancel wiring) would otherwise go to the device entirely untested.
   This suite imports the .android file explicitly and mounts it with the native
   AMap MapView + SDK init + GPS stubbed (mirroring the NearbyHeatView mount
   tests), so a broken handler is caught here instead of after installing the APK.

   `@yon/shared` is the real source (jest.config maps it), so wgs84ToGcj02 /
   gcj02ToWgs84 here are the SAME conversions the component uses — only the
   network call (reverseGeocode) is stubbed.
   ============================================================ */

import TestRenderer, { act } from 'react-test-renderer'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { wgs84ToGcj02, gcj02ToWgs84, reverseGeocode } from '@yon/shared'

// --- Native map: capture mount props + expose onCameraIdle to the test. ---
const mapMounts: Array<Record<string, unknown>> = []
const mockMoveCamera = jest.fn()
jest.mock('react-native-amap3d', () => {
  const React = require('react')
  class MapView extends React.Component {
    moveCamera = (...args: unknown[]) => mockMoveCamera(...args)
    render() {
      mapMounts.push(this.props as Record<string, unknown>)
      return React.createElement('MapViewMock', this.props, (this.props as { children?: unknown }).children)
    }
  }
  return {
    MapView,
    Marker: (props: Record<string, unknown>) => React.createElement('MarkerMock', props),
  }
})

const mockInitAmap = jest.fn()
jest.mock('@/lib/amapPrivacy', () => ({
  initAmapIfConsented: (...args: unknown[]) => mockInitAmap(...args),
}))

const mockRequestLocate = jest.fn()
jest.mock('@/app/(tabs)/_useUserCoords', () => ({
  requestLocateResult: (...args: unknown[]) => mockRequestLocate(...args),
}))

// Keep the real geo math; stub only the network reverse-geocode.
jest.mock('@yon/shared', () => {
  const actual = jest.requireActual('@yon/shared')
  return { ...actual, reverseGeocode: jest.fn() }
})

jest.mock('@/providers/I18nProvider', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

jest.mock('@/components/ds', () => {
  const React = require('react')
  return {
    Button: ({ children, ...props }: { children?: React.ReactNode }) =>
      React.createElement('Button', props, children),
    Card: ({ children, ...props }: { children?: React.ReactNode }) =>
      React.createElement('Card', props, children),
    Icon: (props: Record<string, unknown>) => React.createElement('Icon', props),
  }
})

import LocationPicker, { type LatLngLiteral } from '../LocationPicker.android'

const mockReverse = reverseGeocode as jest.Mock
const CONSENT_KEY = 'yon_amap_consent'
const PICK_ZOOM = 16
const REVERSE_DEBOUNCE_MS = 500

// A clearly-inside-China pin (Shanghai People's Square, WGS-84).
const CHINA: LatLngLiteral = { lat: 31.2304, lng: 121.4737 }

const mounted: TestRenderer.ReactTestRenderer[] = []

interface PickerProps {
  visible?: boolean
  initial?: LatLngLiteral | null
  onCancel?: () => void
  onConfirm?: (coords: LatLngLiteral, place: string | null) => void
}

async function renderPicker(props: PickerProps = {}): Promise<TestRenderer.ReactTestRenderer> {
  let renderer!: TestRenderer.ReactTestRenderer
  await act(async () => {
    renderer = TestRenderer.create(
      <LocationPicker
        visible={props.visible ?? true}
        initial={props.initial ?? null}
        onCancel={props.onCancel ?? (() => {})}
        onConfirm={props.onConfirm ?? (() => {})}
      />,
    )
  })
  mounted.push(renderer)
  return renderer
}

function latestCamera(): { target: { latitude: number; longitude: number }; zoom: number } {
  const last = mapMounts[mapMounts.length - 1]
  return last.initialCameraPosition as { target: { latitude: number; longitude: number }; zoom: number }
}

// RN Pressable forwards testID to its host child, so a testID can match two
// nodes; take the outermost (the element with the props exactly as authored).
function byId(renderer: TestRenderer.ReactTestRenderer, id: string) {
  return renderer.root.findAllByProps({ testID: id })[0]
}

/** Fire the MapView's onCameraIdle with a GCJ-02 center (as AMap reports it). */
async function settleCameraAt(gcj: { lat: number; lng: number }): Promise<void> {
  const props = mapMounts[mapMounts.length - 1]
  const onCameraIdle = props.onCameraIdle as (e: unknown) => void
  await act(async () => {
    onCameraIdle({ nativeEvent: { cameraPosition: { target: { latitude: gcj.lat, longitude: gcj.lng } } } })
  })
}

describe('LocationPicker.android — real component', () => {
  beforeEach(async () => {
    jest.clearAllMocks()
    mapMounts.length = 0
    await AsyncStorage.clear()
    mockReverse.mockResolvedValue({ place: 'Resolved Address' })
    mockRequestLocate.mockResolvedValue({ coords: { lat: 31.2, lng: 121.5 }, status: 'ok' })
  })

  afterEach(() => {
    act(() => {
      mounted.forEach((r) => r.unmount())
    })
    mounted.length = 0
  })

  describe('consent gate (AMap compliance)', () => {
    it('does NOT mount the map until consent is granted, then mounts it on agree', async () => {
      // No stored consent → the SDK must not init and the map must not mount.
      const renderer = await renderPicker({ initial: CHINA })
      expect(mapMounts).toHaveLength(0)
      expect(mockInitAmap).not.toHaveBeenCalled()

      // Agree → SDK inits, consent persists, the map mounts.
      const agree = byId(renderer, 'loc-picker-consent-agree')
      await act(async () => {
        await agree.props.onPress()
      })

      expect(mockInitAmap).toHaveBeenCalledWith(true)
      expect(await AsyncStorage.getItem(CONSENT_KEY)).toBe('true')
      expect(mapMounts.length).toBeGreaterThan(0)
    })

    it('mounts the map straight away when consent was previously granted', async () => {
      await AsyncStorage.setItem(CONSENT_KEY, 'true')
      await renderPicker({ initial: CHINA })

      expect(mockInitAmap).toHaveBeenCalledWith(true)
      expect(mapMounts.length).toBeGreaterThan(0)
      // No consent-agree button once the map is up.
      expect(mounted[0].root.findAllByProps({ testID: 'loc-picker-consent-agree' })).toHaveLength(0)
    })
  })

  describe('initial camera (WGS-84 seed → GCJ-02)', () => {
    beforeEach(async () => {
      await AsyncStorage.setItem(CONSENT_KEY, 'true')
    })

    it('opens centered on the seed pin, converted to GCJ-02, at PICK_ZOOM', async () => {
      await renderPicker({ initial: CHINA })
      const cam = latestCamera()
      const expected = wgs84ToGcj02(CHINA.lat, CHINA.lng)
      expect(cam.zoom).toBe(PICK_ZOOM)
      expect(cam.target.latitude).toBeCloseTo(expected.lat, 6)
      expect(cam.target.longitude).toBeCloseTo(expected.lng, 6)
      // Raw WGS-84 would NOT match the GCJ-02 target — guards a missing conversion.
      expect(cam.target.latitude).not.toBeCloseTo(CHINA.lat, 6)
    })

    it('falls back to the Shanghai center when there is no seed pin', async () => {
      await renderPicker({ initial: null })
      const cam = latestCamera()
      const expected = wgs84ToGcj02(31.2304, 121.4737)
      expect(cam.target.latitude).toBeCloseTo(expected.lat, 6)
      expect(cam.target.longitude).toBeCloseTo(expected.lng, 6)
    })
  })

  describe('picking a point', () => {
    beforeEach(async () => {
      await AsyncStorage.setItem(CONSENT_KEY, 'true')
    })

    it('disables Confirm until a pin exists, and confirms WGS-84 coords from the GCJ-02 center', async () => {
      const onConfirm = jest.fn()
      const renderer = await renderPicker({ initial: null, onConfirm })

      // No seed pin → Confirm is disabled (and dimmed).
      const confirmBefore = byId(renderer, 'loc-picker-confirm')
      expect(confirmBefore.props.disabled).toBe(true)

      // Drag so the camera center lands on the GCJ-02 image of a known WGS point.
      const gcj = wgs84ToGcj02(CHINA.lat, CHINA.lng)
      await settleCameraAt(gcj)

      const confirmAfter = byId(renderer, 'loc-picker-confirm')
      expect(confirmAfter.props.disabled).toBe(false)

      await act(async () => {
        confirmAfter.props.onPress()
      })

      // The confirmed coords are WGS-84 (gcj02ToWgs84 of the center) ≈ the
      // original pin — never the raw GCJ-02 center.
      expect(onConfirm).toHaveBeenCalledTimes(1)
      const [coords] = onConfirm.mock.calls[0]
      const expected = gcj02ToWgs84(gcj.lat, gcj.lng)
      expect(coords.lat).toBeCloseTo(expected.lat, 6)
      expect(coords.lng).toBeCloseTo(expected.lng, 6)
      expect(coords.lat).toBeCloseTo(CHINA.lat, 4)
      expect(coords.lng).toBeCloseTo(CHINA.lng, 4)
      // And NOT the raw GCJ center (would mean a missing conversion).
      expect(coords.lat).not.toBeCloseTo(gcj.lat, 6)
    })

    it('reverse-geocodes the picked center (WGS-84) after the debounce and confirms the address', async () => {
      mockReverse.mockResolvedValue({ place: 'Tiger Sugar · Hongdae' })
      const onConfirm = jest.fn()
      const renderer = await renderPicker({ initial: null, onConfirm })

      const gcj = wgs84ToGcj02(CHINA.lat, CHINA.lng)
      await settleCameraAt(gcj)

      // Let the 500ms debounce fire and the (mocked) network resolve.
      await act(async () => {
        await new Promise((res) => setTimeout(res, REVERSE_DEBOUNCE_MS + 50))
      })

      // reverseGeocode is called with the WGS-84 coords, not the GCJ-02 center.
      expect(mockReverse).toHaveBeenCalledTimes(1)
      const [rlat, rlng] = mockReverse.mock.calls[0]
      expect(rlat).toBeCloseTo(CHINA.lat, 4)
      expect(rlng).toBeCloseTo(CHINA.lng, 4)

      // The resolved address shows and rides along on confirm.
      const addr = byId(renderer, 'loc-picker-address')
      expect(addr.props.children).toBe('Tiger Sugar · Hongdae')

      await act(async () => {
        byId(renderer, 'loc-picker-confirm').props.onPress()
      })
      expect(onConfirm).toHaveBeenCalledWith(
        expect.objectContaining({ lat: expect.any(Number) }),
        'Tiger Sugar · Hongdae',
      )
    })

    it('survives a reverse-geocode failure — coords still confirm, address stays empty', async () => {
      mockReverse.mockRejectedValue(new Error('network'))
      const onConfirm = jest.fn()
      const renderer = await renderPicker({ initial: CHINA, onConfirm })

      await settleCameraAt(wgs84ToGcj02(CHINA.lat, CHINA.lng))
      await act(async () => {
        await new Promise((res) => setTimeout(res, REVERSE_DEBOUNCE_MS + 50))
      })

      await act(async () => {
        byId(renderer, 'loc-picker-confirm').props.onPress()
      })
      // Confirmed with coords + a null address (never blocked by the failure).
      expect(onConfirm).toHaveBeenCalledTimes(1)
      const [coords, place] = onConfirm.mock.calls[0]
      expect(coords.lat).toBeCloseTo(CHINA.lat, 4)
      expect(place).toBeNull()
    })
  })

  describe('reseed + dismiss', () => {
    beforeEach(async () => {
      await AsyncStorage.setItem(CONSENT_KEY, 'true')
    })

    it('reseeds the pin when reopened on a different taste', async () => {
      const onConfirm = jest.fn()
      const A = { lat: 31.2304, lng: 121.4737 }
      const B = { lat: 39.9087, lng: 116.3975 } // Beijing
      const renderer = await renderPicker({ initial: A, onConfirm })

      // Reopen with a new seed (visible stays true, initial changes).
      await act(async () => {
        renderer.update(
          <LocationPicker visible initial={B} onCancel={() => {}} onConfirm={onConfirm} />,
        )
      })

      await act(async () => {
        byId(renderer, 'loc-picker-confirm').props.onPress()
      })
      const [coords] = onConfirm.mock.calls[0]
      expect(coords.lat).toBeCloseTo(B.lat, 6)
      expect(coords.lng).toBeCloseTo(B.lng, 6)
    })

    it('fires onCancel from the header dismiss', async () => {
      const onCancel = jest.fn()
      const renderer = await renderPicker({ initial: CHINA, onCancel })
      await act(async () => {
        byId(renderer, 'loc-picker-cancel').props.onPress()
      })
      expect(onCancel).toHaveBeenCalledTimes(1)
    })

    it('recenters on the user GPS fix (converted to GCJ-02) via the locate control', async () => {
      mockRequestLocate.mockResolvedValue({ coords: { lat: 30.0, lng: 120.0 }, status: 'ok' })
      const renderer = await renderPicker({ initial: CHINA })

      await act(async () => {
        await byId(renderer, 'loc-picker-locate').props.onPress()
      })

      expect(mockMoveCamera).toHaveBeenCalledTimes(1)
      const [camera] = mockMoveCamera.mock.calls[0]
      const expected = wgs84ToGcj02(30.0, 120.0)
      expect(camera.target.latitude).toBeCloseTo(expected.lat, 6)
      expect(camera.target.longitude).toBeCloseTo(expected.lng, 6)
    })
  })
})
