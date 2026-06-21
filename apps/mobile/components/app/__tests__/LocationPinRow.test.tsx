/* ============================================================
   Unit tests — LocationPinRow (定位地址 row, shared by Add + Detail).

   The "pick on map" button is Android-only (the AMap SDK is native-Android),
   so jest's default ios platform never renders it. These tests flip Platform.OS
   to exercise BOTH branches: that Android shows the open button (and its
   label/press wiring), and that web/ios still shows the pin status + clear so a
   pin set on Android remains visible/removable elsewhere. This is exactly the
   platform-gated rendering that wouldn't show up until running the APK.
   ============================================================ */

import TestRenderer, { act } from 'react-test-renderer'
import { Platform } from 'react-native'

import LocationPinRow from '../LocationPinRow'

jest.mock('@/providers/I18nProvider', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

jest.mock('@/components/ds', () => {
  const React = require('react')
  return {
    Button: ({ children, ...props }: { children?: React.ReactNode }) =>
      React.createElement('Button', props, children),
    Icon: (props: Record<string, unknown>) => React.createElement('Icon', props),
  }
})

const ORIGINAL_OS = Platform.OS
const mounted: TestRenderer.ReactTestRenderer[] = []

function render(props: Partial<React.ComponentProps<typeof LocationPinRow>> = {}) {
  let renderer!: TestRenderer.ReactTestRenderer
  act(() => {
    renderer = TestRenderer.create(
      <LocationPinRow
        lat={props.lat ?? null}
        lng={props.lng ?? null}
        onOpenPicker={props.onOpenPicker ?? (() => {})}
        onClear={props.onClear ?? (() => {})}
      />,
    )
  })
  mounted.push(renderer)
  return renderer
}

function firstByTestId(renderer: TestRenderer.ReactTestRenderer, id: string) {
  return renderer.root.findAllByProps({ testID: id })[0]
}
function allByTestId(renderer: TestRenderer.ReactTestRenderer, id: string) {
  return renderer.root.findAllByProps({ testID: id })
}

afterEach(() => {
  act(() => {
    mounted.forEach((r) => r.unmount())
  })
  mounted.length = 0
  ;(Platform as { OS: string }).OS = ORIGINAL_OS
})

describe('LocationPinRow on Android', () => {
  beforeEach(() => {
    ;(Platform as { OS: string }).OS = 'android'
  })

  it('shows the "pick on map" button when there is no pin', () => {
    const onOpenPicker = jest.fn()
    const renderer = render({ lat: null, lng: null, onOpenPicker })

    const open = firstByTestId(renderer, 'location-pin-open')
    expect(open.props.children).toBe('loc_pick_on_map')

    // Status reads "no pin"; no clear affordance when empty.
    expect(firstByTestId(renderer, 'location-pin-status').props.children).toBe('loc_pin_none')
    expect(allByTestId(renderer, 'location-pin-clear')).toHaveLength(0)

    act(() => open.props.onPress())
    expect(onOpenPicker).toHaveBeenCalledTimes(1)
  })

  it('switches the button to "change pin", shows coords + clear when a pin is set', () => {
    const onClear = jest.fn()
    const renderer = render({ lat: 31.2304, lng: 121.4737, onClear })

    expect(firstByTestId(renderer, 'location-pin-open').props.children).toBe('loc_pin_change')

    // Status shows the set label and the rounded coordinates.
    const status = firstByTestId(renderer, 'location-pin-status').props.children as string
    expect(status).toContain('loc_pin_set')
    expect(status).toContain('31.23040')
    expect(status).toContain('121.47370')

    const clear = firstByTestId(renderer, 'location-pin-clear')
    act(() => clear.props.onPress())
    expect(onClear).toHaveBeenCalledTimes(1)
  })
})

describe('LocationPinRow on web/iOS (no native map)', () => {
  beforeEach(() => {
    ;(Platform as { OS: string }).OS = 'ios'
  })

  it('hides the map button but still shows + can clear an existing pin', () => {
    const onClear = jest.fn()
    const renderer = render({ lat: 1.5, lng: 2.5, onClear })

    // No map picker entry point off Android.
    expect(allByTestId(renderer, 'location-pin-open')).toHaveLength(0)

    // Pin status + clear remain available so an Android-set pin is removable.
    const status = firstByTestId(renderer, 'location-pin-status').props.children as string
    expect(status).toContain('loc_pin_set')
    const clear = firstByTestId(renderer, 'location-pin-clear')
    act(() => clear.props.onPress())
    expect(onClear).toHaveBeenCalledTimes(1)
  })

  it('shows the no-pin status and no map button when empty', () => {
    const renderer = render({ lat: null, lng: null })
    expect(allByTestId(renderer, 'location-pin-open')).toHaveLength(0)
    expect(firstByTestId(renderer, 'location-pin-status').props.children).toBe('loc_pin_none')
  })
})
