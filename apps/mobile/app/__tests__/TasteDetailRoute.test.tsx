/* ============================================================
   Regression test — taste detail route must NOT apply paddingTop:insets.top.

   Bug: the route container applied paddingTop:insets.top AND EditActionHeader
   applied insets.top+12, yielding 2×inset+12 of dead space above the header
   in edit mode. The fix moves inset ownership into DetailView itself, so the
   route container is a plain flex:1 cream wrapper with no top padding.

   This test mounts ONLY the route (DetailView stubbed out) so it asserts "route
   adds no inset" independently of DetailView internals.
   ============================================================ */

import React from 'react'
import { StyleSheet } from 'react-native'
import TestRenderer, { act } from 'react-test-renderer'

import TasteDetailRoute from '../taste/[id]'

// Stub DetailView — we are only testing the route shell, not the detail content.
jest.mock('@/components/app/DetailView', () => {
  const React = require('react')
  return {
    __esModule: true,
    default: () => React.createElement('DetailViewStub'),
  }
})

// Use a nonzero top (47) so that a paddingTop:insets.top on the route would be
// detectable. The official zero-insets global mock (jest.setup.js) is overridden
// here to ensure a false-negative is impossible.
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 47, bottom: 0, left: 0, right: 0 }),
}))

describe('TasteDetailRoute container', () => {
  it('does not apply paddingTop:insets.top — inset is owned by DetailView', async () => {
    let renderer!: TestRenderer.ReactTestRenderer
    await act(async () => {
      renderer = TestRenderer.create(<TasteDetailRoute />)
    })

    // Find the route container by testID — avoids type-unsafe node.type comparison.
    const rootView = renderer.root.findByProps({ testID: 'taste-detail-container' })
    const flat = StyleSheet.flatten(rootView.props.style)

    // Must NOT be 47 (insets.top) — the route no longer pads the safe area.
    expect(flat.paddingTop).not.toBe(47)
    // Explicit: paddingTop is undefined or 0.
    expect(flat.paddingTop == null || flat.paddingTop === 0).toBe(true)
  })
})
