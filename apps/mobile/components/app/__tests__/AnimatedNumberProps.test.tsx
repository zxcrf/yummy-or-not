/* ============================================================
   Regression — AnimatedNumber forwards RN TextProps to Animated.Text.

   Finding: `...textProps` was typed as `[prop: string]: unknown`, so
   color, fontSize, numberOfLines and a11y props were silently dropped
   when callers passed them.

   Fix: props interface extends Omit<TextProps, 'children'>; the render
   forwards style separately (merged after textBase) and spreads the
   remaining TextProps onto Animated.Text.
   ============================================================ */

import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import AnimatedNumber from '../AnimatedNumber'

function render(props: React.ComponentProps<typeof AnimatedNumber>) {
  let renderer!: TestRenderer.ReactTestRenderer
  act(() => {
    renderer = TestRenderer.create(<AnimatedNumber {...props} />)
  })
  return renderer
}

// The Reanimated mock renders Animated.Text as a host 'Text' node.
function findText(renderer: TestRenderer.ReactTestRenderer) {
  return renderer.root.findAll((n) => (n.type as unknown as string) === 'Text')[0]
}

describe('AnimatedNumber — TextProps forwarding (finding: props dropped)', () => {
  it('forwards testID to the Animated.Text node', () => {
    const renderer = render({ value: 42, testID: 'stat-count' })
    const text = findText(renderer)
    expect(text).toBeTruthy()
    expect(text.props.testID).toBe('stat-count')
  })

  it('forwards numberOfLines to Animated.Text', () => {
    const renderer = render({ value: 7, numberOfLines: 1 })
    const text = findText(renderer)
    expect(text).toBeTruthy()
    expect(text.props.numberOfLines).toBe(1)
  })

  it('forwards accessibilityLabel to Animated.Text', () => {
    const renderer = render({ value: 10, accessibilityLabel: '10 items' })
    const text = findText(renderer)
    expect(text).toBeTruthy()
    expect(text.props.accessibilityLabel).toBe('10 items')
  })

  it('merges caller style after textBase (caller overrides base defaults)', () => {
    const { StyleSheet } = require('react-native')
    const renderer = render({ value: 5, style: { fontSize: 24, color: '#ff0000' } })
    const text = findText(renderer)
    expect(text).toBeTruthy()
    const flat = StyleSheet.flatten(text.props.style)
    // Caller style (fontSize:24) wins over textBase (fontSize:16).
    expect(flat.fontSize).toBe(24)
    expect(flat.color).toBe('#ff0000')
  })

  it('renders without extra props (no error)', () => {
    expect(() => {
      act(() => {
        TestRenderer.create(<AnimatedNumber value={0} />)
      })
    }).not.toThrow()
  })
})
