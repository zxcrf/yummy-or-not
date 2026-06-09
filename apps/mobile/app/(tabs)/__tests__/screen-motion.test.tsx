/* ============================================================
   Regression tests — tab motion.

   User report: the four content tabs (你的口味 / 回忆 / 统计 / 我的) had no
   transition or enter animation — switching and landing on a page was an
   instant snap. These tests pin the contract:

   1. The tab navigator configures a real cross-tab scene `animation`
      (not 'none'), so every tab switch transitions instead of hard-cutting.
   2. The shared Screen frame wraps every tab body in a reanimated entrance
      (`entering`), so a page fades in rather than appearing instantly.

   Both fail against the old code (no `animation` option; plain View wrapper)
   and pass against the fix.
   ============================================================ */

import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'

/* ---- mocks shared by both suites ---- */
jest.mock('../_nav', () => ({
  SIDEBAR_W: 240,
  AppNav: () => null,
}))

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}))

jest.mock('tamagui', () => {
  const ReactLib = require('react')
  return {
    View: ({ children, ...props }: { children?: React.ReactNode }) =>
      ReactLib.createElement('View', props, children),
    useMedia: () => ({ gtMd: false }),
  }
})

// Capture what TabsLayout passes to expo-router's <Tabs>.
let capturedTabsProps: Record<string, unknown> | undefined
jest.mock('expo-router', () => {
  const Tabs = (props: Record<string, unknown>) => {
    capturedTabsProps = props
    return null
  }
  Tabs.Screen = () => null
  return { Tabs }
})

describe('tab navigator transition', () => {
  it('configures a non-instant cross-tab scene animation', () => {
    const TabsLayout = require('../_layout').default

    act(() => {
      TestRenderer.create(React.createElement(TabsLayout))
    })

    const screenOptions = capturedTabsProps?.screenOptions as
      | { animation?: string }
      | undefined
    expect(screenOptions).toBeTruthy()
    // The reported bug was the absence of any transition — assert one exists
    // and is not explicitly disabled.
    expect(screenOptions?.animation).toBeDefined()
    expect(screenOptions?.animation).not.toBe('none')
  })
})

describe('Screen content entrance', () => {
  it('wraps the tab body in a reanimated entering animation', () => {
    const { Screen } = require('../_screen')
    const Body = () => null

    let renderer!: TestRenderer.ReactTestRenderer
    act(() => {
      renderer = TestRenderer.create(
        React.createElement(Screen, null, React.createElement(Body))
      )
    })

    // At least one node carries an `entering` prop (the old plain-View
    // wrapper had none).
    const entrances = renderer.root.findAll(
      (node) => Boolean(node.props && node.props.entering)
    )
    expect(entrances.length).toBeGreaterThan(0)

    // ...and the page body renders inside it (the entrance wraps content,
    // it doesn't replace it).
    expect(entrances[0].findByType(Body)).toBeTruthy()
  })
})
