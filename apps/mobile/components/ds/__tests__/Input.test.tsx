/* ============================================================
   Regression test — Input text color on Android.
   Bug: styled(TInput, { color: '$ink900' }) — the Tamagui theme token
   is not applied to Android TextInput's text color, so typed characters
   are invisible (white text on white background).
   Fix: _FIELD_COLOR = '#191017' (the resolved hex of palette.ink900)
   is used directly in the styled definition.
   ============================================================ */
import { _FIELD_COLOR } from '../Input'

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
