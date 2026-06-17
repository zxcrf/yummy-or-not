/* ============================================================
   RED test — 4-B nav swap: _layout.tsx must register `recall`
   instead of `todo`, in position [index, recall, nearby, you].

   Fails against current code because _layout.tsx still registers
   `todo` and has no `recall` screen.
   ============================================================ */

import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'

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

jest.mock('../_nav', () => ({ AppNav: () => null }))

import TabsLayout from '../_layout'

describe('(tabs) layout — recall replaces todo (4-B nav swap)', () => {
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

  it('registers a "recall" tab screen', () => {
    act(() => {
      renderer = TestRenderer.create(React.createElement(TabsLayout))
    })
    expect(registered).toContain('recall')
  })

  it('does NOT register a "todo" tab screen', () => {
    act(() => {
      renderer = TestRenderer.create(React.createElement(TabsLayout))
    })
    expect(registered).not.toContain('todo')
  })

  it('orders screens as: index → recall → nearby → you', () => {
    act(() => {
      renderer = TestRenderer.create(React.createElement(TabsLayout))
    })
    expect(registered).toEqual(['index', 'recall', 'nearby', 'you'])
  })
})
