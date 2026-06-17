/* ============================================================
   Regression test (issue #97) — 附近·热力 is a registered bottom tab.

   "附近 · 热力" used to be a root-level pushed card (app/nearby.tsx), which
   is why Android back exited the app (nothing to pop to). It is now a tab in
   the (tabs) group. This test pins that the tabs layout registers a screen
   named "nearby", in the 3rd position (index, recall, nearby, you), so the
   route is owned by the tab navigator (back returns to a tab, never exits).
   ============================================================ */

import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'

// Capture every <Tabs.Screen name=...> the layout registers.
const registered: string[] = []

jest.mock('expo-router', () => {
  const React = require('react')
  const Tabs = ({ children }: { children?: React.ReactNode }) =>
    React.createElement('TabsMock', null, children)
  Tabs.Screen = (props: { name: string }) => {
    registered.push(props.name)
    return React.createElement('TabScreenMock', props)
  }
  return { Tabs }
})

// AppNav is passed as the custom tabBar render-prop; the layout never invokes
// it during render, but stub it so the import resolves without RN/native deps.
jest.mock('../_nav', () => ({ AppNav: () => null }))

import TabsLayout from '../_layout'

describe('(tabs) layout — nearby tab registration', () => {
  let renderer: TestRenderer.ReactTestRenderer | null = null

  beforeEach(() => {
    registered.length = 0
  })

  afterEach(() => {
    act(() => {
      renderer?.unmount()
    })
    renderer = null
  })

  it('registers a "nearby" tab screen', () => {
    act(() => {
      renderer = TestRenderer.create(React.createElement(TabsLayout))
    })
    expect(registered).toContain('nearby')
  })

  it('orders nearby 3rd: index → recall → nearby → you', () => {
    act(() => {
      renderer = TestRenderer.create(React.createElement(TabsLayout))
    })
    expect(registered).toEqual(['index', 'recall', 'nearby', 'you'])
  })
})
