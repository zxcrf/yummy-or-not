/* ============================================================
   Regression tests — desktop You tab language switcher ownership.

   User feedback: on the You page the old red language switcher was still
   visible in the desktop sidebar. The page should have one language
   control, owned by YouView's profile row, so AppNav must hide its global
   sidebar switcher only while the You route is active.
   ============================================================ */

import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { AppNav } from '../_nav'

// Drives the responsive switch: AppNav reads `useWindowDimensions().width`
// and renders the Sidebar at width >= 769, else the bottom TabBar.
const mockUseWindowDimensions = jest.fn(() => ({ width: 1024, height: 768 }))
const mockSetLang = jest.fn()
const mockLangSwitcher = jest.fn((props: Record<string, unknown>) =>
  React.createElement('LangSwitcherMock', props),
)

jest.mock('react-native', () => {
  const RN = jest.requireActual('react-native')
  return new Proxy(RN, {
    get: (target, prop) =>
      prop === 'useWindowDimensions' ? mockUseWindowDimensions : target[prop],
  })
})

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}))

jest.mock('@yon/shared', () => ({
  LANGS: [{ code: 'zh', label: 'Chinese', native: '中文' }],
}))

jest.mock('@/providers/I18nProvider', () => ({
  useI18n: () => ({
    lang: 'zh',
    setLang: mockSetLang,
    t: (key: string) => ({
      free_plan: 'Free',
      log_taste: 'Log a taste',
      nav_recall: 'Recall',
      nav_todo: 'To-Try',
      nav_nearby: 'Nearby',
      nav_you: 'You',
      my_tastes: 'My Tastes',
    }[key] ?? key),
  }),
}))

jest.mock('expo-router', () => ({
  Tabs: () => null,
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
}))

jest.mock('@/providers/AddTransitionProvider', () => ({
  useAddTransition: () => ({ fabLayout: { value: null } }),
}))

jest.mock('@/components/ds', () => {
  const React = require('react')
  return {
    Avatar: (props: Record<string, unknown>) => React.createElement('AvatarMock', props),
    Button: ({ children, ...props }: { children?: React.ReactNode }) =>
      React.createElement('ButtonMock', props, children),
    Icon: (props: Record<string, unknown>) => React.createElement('IconMock', props),
    LangSwitcher: (props: Record<string, unknown>) => mockLangSwitcher(props),
  }
})

const routes = [
  { name: 'index', key: 'index-key' },
  { name: 'recall', key: 'recall-key' },
  { name: 'nearby', key: 'nearby-key' },
  { name: 'you', key: 'you-key' },
]

function makeProps(activeRoute: string) {
  const index = routes.findIndex((route) => route.name === activeRoute)
  return {
    state: { index, routes },
    navigation: {
      emit: jest.fn(() => ({ defaultPrevented: false })),
      navigate: jest.fn(),
    },
  }
}

function renderNav(activeRoute: string) {
  act(() => {
    TestRenderer.create(
      React.createElement(
        AppNav,
        makeProps(activeRoute) as unknown as React.ComponentProps<typeof AppNav>,
      ),
    )
  })
}

describe('AppNav desktop language switcher', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockUseWindowDimensions.mockReturnValue({ width: 1024, height: 768 })
  })

  it('hides the global sidebar language switcher while the You tab is active', () => {
    renderNav('you')

    expect(mockLangSwitcher).not.toHaveBeenCalled()
  })

  it('keeps the global sidebar language switcher on other desktop tabs', () => {
    renderNav('index')

    expect(mockLangSwitcher).toHaveBeenCalledTimes(1)
    expect(mockLangSwitcher).toHaveBeenCalledWith(
      expect.objectContaining({
        align: 'left',
        tone: '#ff2e88',
        value: 'zh',
      }),
    )
  })
})

describe('AppNav nav restructure — Recall replaces 想吃 (4-B)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  function renderTree(gtMd: boolean) {
    mockUseWindowDimensions.mockReturnValue(
      gtMd ? { width: 1024, height: 768 } : { width: 390, height: 844 },
    )
    let renderer!: TestRenderer.ReactTestRenderer
    act(() => {
      renderer = TestRenderer.create(
        React.createElement(
          AppNav,
          makeProps('index') as unknown as React.ComponentProps<typeof AppNav>,
        ),
      )
    })
    return renderer
  }

  it.each([
    ['sidebar (desktop)', true],
    ['bottom bar (mobile)', false],
  ])('renders a Recall entry and no To-Try/Stats entry in the %s', (_label, gtMd) => {
    const renderer = renderTree(gtMd as boolean)
    const labels = renderer.root
      .findAll((n) => typeof n.props.children === 'string')
      .map((n) => n.props.children as string)

    expect(labels).toContain('Recall')
    expect(labels).not.toContain('Stats')
    // 想吃/To-Try is folded into Library title dropdown — no longer a tab.
    expect(labels).not.toContain('To-Try')
  })
})

describe('AppNav — 附近 (nearby) is the 3rd bottom tab', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  function renderTree(activeRoute: string, gtMd: boolean) {
    mockUseWindowDimensions.mockReturnValue(
      gtMd ? { width: 1024, height: 768 } : { width: 390, height: 844 },
    )
    let renderer!: TestRenderer.ReactTestRenderer
    act(() => {
      renderer = TestRenderer.create(
        React.createElement(
          AppNav,
          makeProps(activeRoute) as unknown as React.ComponentProps<typeof AppNav>,
        ),
      )
    })
    return renderer
  }

  it.each([
    ['sidebar (desktop)', true],
    ['bottom bar (mobile)', false],
  ])('renders a Nearby entry in the %s', (_label, gtMd) => {
    const renderer = renderTree('index', gtMd as boolean)
    const labels = renderer.root
      .findAll((n) => typeof n.props.children === 'string')
      .map((n) => n.props.children as string)

    expect(labels).toContain('Nearby')
  })

  it('Nearby sits AFTER Recall and BEFORE You (3rd position) in the bottom bar', () => {
    const renderer = renderTree('index', false)
    const labels = renderer.root
      .findAll((n) => typeof n.props.children === 'string')
      .map((n) => n.props.children as string)

    const recall = labels.indexOf('Recall')
    const nearby = labels.indexOf('Nearby')
    const you = labels.indexOf('You')
    expect(recall).toBeGreaterThanOrEqual(0)
    expect(nearby).toBeGreaterThan(recall)
    expect(you).toBeGreaterThan(nearby)
  })

  it('tapping the Nearby tab navigates to the nearby route (no exit)', () => {
    const props = makeProps('index') as unknown as React.ComponentProps<typeof AppNav> & {
      navigation: { emit: jest.Mock; navigate: jest.Mock }
    }
    mockUseWindowDimensions.mockReturnValue({ width: 390, height: 844 })
    let renderer!: TestRenderer.ReactTestRenderer
    act(() => {
      renderer = TestRenderer.create(React.createElement(AppNav, props))
    })
    // Find the pressable whose subtree renders the 'Nearby' label and press it.
    const pressables = renderer.root.findAll(
      (n) =>
        n.props.accessibilityRole === 'button' &&
        typeof n.props.onPress === 'function' &&
        n.findAll((c) => c.props.children === 'Nearby').length > 0,
    )
    expect(pressables.length).toBeGreaterThan(0)
    act(() => {
      pressables[0].props.onPress()
    })
    expect(props.navigation.navigate).toHaveBeenCalledWith('nearby')
  })
})
