/* ============================================================
   Regression test — Input text color on Android.

   Bug: the field wrapped Tamagui's styled(TextInput). On Android release
   (EAS/Gradle) builds the resolved text `color` never reached the native
   TextInput, so typed characters were invisible (dark text rendered as
   white-on-white). Passing `color` through styled() or even the `style`
   prop did not fix it — Tamagui's native path swallowed it.

   Fix: on Android, Input renders a RAW react-native <TextInput> with a
   plain style object, so `color: #191017` lands directly on the native
   input. These tests pin that: on Android a real RN TextInput is in the
   tree and its resolved text color is the concrete ink900 hex.
   ============================================================ */
import TestRenderer, { act } from 'react-test-renderer'
import { Platform, StyleSheet, TextInput } from 'react-native'
import { Input, _FIELD_COLOR } from '../Input'

describe('Input._FIELD_COLOR', () => {
  it('is a concrete hex value, not a Tamagui theme token', () => {
    // Any string starting with '$' is a Tamagui token and won't resolve
    // to a text color on Android's TextInput component.
    expect(_FIELD_COLOR).not.toMatch(/^\$/)
  })

  it('matches the palette ink900 value (#191017)', () => {
    expect(_FIELD_COLOR).toBe('#191017')
  })
})

describe('Input on Android', () => {
  let realOS: typeof Platform.OS

  beforeEach(() => {
    realOS = Platform.OS
    // Force the Android branch (jest-expo defaults to ios).
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' })
  })
  afterEach(() => {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: realOS })
  })

  function render() {
    let renderer!: TestRenderer.ReactTestRenderer
    act(() => {
      renderer = TestRenderer.create(
        <Input label="Email" placeholder="you@example.com" value="" onChangeText={() => {}} />
      )
    })
    return renderer
  }

  it('renders a real react-native TextInput (not the Tamagui-styled field)', () => {
    // The pre-fix code rendered Tamagui's Input, which is NOT the react-native
    // TextInput class — so this lookup would throw against the old path.
    expect(render().root.findByType(TextInput)).toBeTruthy()
  })

  it('sets the native text color to the concrete ink900 hex', () => {
    const field = render().root.findByType(TextInput)
    const style = StyleSheet.flatten(field.props.style)
    // This is the exact thing that broke: invisible typed text.
    expect(style.color).toBe(_FIELD_COLOR)
    expect(style.color).toBe('#191017')
  })

  it('gives the placeholder a concrete color, not a Tamagui token', () => {
    const field = render().root.findByType(TextInput)
    expect(field.props.placeholderTextColor).toMatch(/^#[0-9a-fA-F]{6}$/)
  })
})
