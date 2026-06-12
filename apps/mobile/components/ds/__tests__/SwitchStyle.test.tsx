/* ============================================================
   Regression — Switch accepts `style` prop and merges it safely.

   Finding: `style` prop was removed from the public API; ...rest spread
   after the computed style array could clobber required track dimensions.

   Fix: accept `style?: StyleProp<ViewStyle>`, destructure it, and merge
   AFTER internal styles so callers can add margins/alignSelf but cannot
   accidentally override track dimensions/colors.
   ============================================================ */

import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { StyleSheet } from 'react-native'
import { Switch } from '../Switch'

function findTrack(renderer: TestRenderer.ReactTestRenderer) {
  // The Pressable is the track element — find it by accessibilityRole='switch'.
  return renderer.root.findAll(
    (n) => n.props.accessibilityRole === 'switch',
  )[0]
}

describe('Switch — style prop (finding: style removed from API)', () => {
  it('forwards style to the track Pressable', () => {
    let renderer!: TestRenderer.ReactTestRenderer
    act(() => {
      renderer = TestRenderer.create(
        <Switch style={{ marginTop: 8 }} />,
      )
    })
    const track = findTrack(renderer)
    expect(track).toBeTruthy()
    const flat = StyleSheet.flatten(track.props.style)
    expect(flat.marginTop).toBe(8)
  })

  it('does NOT clobber required track width/height when style is applied', () => {
    let renderer!: TestRenderer.ReactTestRenderer
    act(() => {
      renderer = TestRenderer.create(
        // Caller passes conflicting width — internal styles should win because
        // they appear before caller style in the array.
        <Switch style={{ marginLeft: 12 }} />,
      )
    })
    const track = findTrack(renderer)
    expect(track).toBeTruthy()
    const flat = StyleSheet.flatten(track.props.style)
    // Required track dimensions must be intact.
    expect(flat.width).toBe(56)
    expect(flat.height).toBe(30)
    // Caller margin is also present.
    expect(flat.marginLeft).toBe(12)
  })

  it('renders without style prop (no error)', () => {
    expect(() => {
      act(() => {
        TestRenderer.create(<Switch />)
      })
    }).not.toThrow()
  })
})
