/* ============================================================
   Regression test — Textarea text color + multiline + textAlignVertical.

   Pins the same invisible-text regression class as Input.test.tsx:
   the field must render a real RN TextInput (not a Tamagui wrapper),
   carry concrete ink900 hex as text color, be multiline, and have
   textAlignVertical:'top' so the cursor starts at the top of the box.
   ============================================================ */
import TestRenderer, { act } from 'react-test-renderer'
import { StyleSheet, TextInput } from 'react-native'
import { Textarea } from '../Textarea'

describe('Textarea', () => {
  function render(props?: object) {
    let renderer!: TestRenderer.ReactTestRenderer
    act(() => {
      renderer = TestRenderer.create(
        <Textarea
          label="Notes"
          placeholder="Write something…"
          value=""
          onChangeText={() => {}}
          {...props}
        />
      )
    })
    return renderer
  }

  it('renders a real react-native TextInput (not a Tamagui-styled field)', () => {
    expect(render().root.findByType(TextInput)).toBeTruthy()
  })

  it('sets the native text color to the concrete ink900 hex (#191017)', () => {
    const field = render().root.findByType(TextInput)
    const style = StyleSheet.flatten(field.props.style)
    expect(style.color).toBe('#191017')
  })

  it('is multiline', () => {
    const field = render().root.findByType(TextInput)
    expect(field.props.multiline).toBe(true)
  })

  it('has textAlignVertical set to top', () => {
    const field = render().root.findByType(TextInput)
    const style = StyleSheet.flatten(field.props.style)
    expect(style.textAlignVertical).toBe('top')
  })

  it('gives the placeholder a concrete color, not a Tamagui token', () => {
    const field = render().root.findByType(TextInput)
    expect(field.props.placeholderTextColor).toMatch(/^#[0-9a-fA-F]{6}$/)
  })
})
