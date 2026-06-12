/* ============================================================
   Regression — LangSwitcher forwards style, testID, accessibilityLabel
   to the root wrapper View.

   Finding: Props API dropped the Tamagui View pass-through surface;
   style, testID, and a11y props were silently dropped.

   Fix: explicit style/testID/accessibilityLabel props added to
   LangSwitcherProps, destructured, and spread onto the root View.
   ============================================================ */

import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { StyleSheet } from 'react-native'
import { LangSwitcher } from '../LangSwitcher'

const LANGS = [{ code: 'en', label: 'English', native: 'English' }]

function render(props: React.ComponentProps<typeof LangSwitcher>) {
  let renderer!: TestRenderer.ReactTestRenderer
  act(() => {
    renderer = TestRenderer.create(<LangSwitcher {...props} />)
  })
  return renderer
}

describe('LangSwitcher — root View props (finding: style/testID/a11y dropped)', () => {
  it('forwards testID to the root View', () => {
    const renderer = render({ value: 'en', languages: LANGS, testID: 'lang-switcher' })
    const nodes = renderer.root.findAll((n) => n.props.testID === 'lang-switcher')
    expect(nodes.length).toBeGreaterThan(0)
  })

  it('forwards accessibilityLabel to the root View', () => {
    const renderer = render({ value: 'en', languages: LANGS, accessibilityLabel: 'Language selector' })
    const nodes = renderer.root.findAll((n) => n.props.accessibilityLabel === 'Language selector')
    // The root View carries it; the trigger Pressable may also have its own label — check at least one.
    expect(nodes.length).toBeGreaterThan(0)
  })

  it('forwards style to the root View', () => {
    const renderer = render({ value: 'en', languages: LANGS, style: { marginTop: 16 } })
    // The root View is the outermost View-type node.
    const views = renderer.root.findAll((n) => (n.type as unknown as string) === 'View')
    const rootView = views[0]
    expect(rootView).toBeTruthy()
    const flat = StyleSheet.flatten(rootView.props.style)
    expect(flat.marginTop).toBe(16)
  })

  it('retains alignSelf: flex-start on root View even with caller style', () => {
    const renderer = render({ value: 'en', languages: LANGS, style: { marginBottom: 4 } })
    const views = renderer.root.findAll((n) => (n.type as unknown as string) === 'View')
    const rootView = views[0]
    const flat = StyleSheet.flatten(rootView.props.style)
    expect(flat.alignSelf).toBe('flex-start')
    expect(flat.marginBottom).toBe(4)
  })
})
