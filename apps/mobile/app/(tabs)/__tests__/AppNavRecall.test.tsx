/* ============================================================
   RED test — 4-B nav swap: _nav.tsx NAV array must route to
   `recall` (not `todo`), render the "Recall" label, and use
   icon name `clock`.

   Fails against current code because NAV still has:
     { route: 'todo', icon: 'bookmark', labelKey: 'nav_todo' }
   ============================================================ */

import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { AppNav } from '../_nav'

const mockUseWindowDimensions = jest.fn(() => ({ width: 390, height: 844 }))

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
    setLang: jest.fn(),
    t: (key: string) =>
      ({
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

// Capture every Icon rendered so we can assert on icon names used in the nav.
const renderedIcons: string[] = []

jest.mock('@/components/ds', () => {
  const React = require('react')
  return {
    Avatar: (props: Record<string, unknown>) => React.createElement('AvatarMock', props),
    Button: ({ children, ...props }: { children?: React.ReactNode }) =>
      React.createElement('ButtonMock', props, children),
    Icon: (props: Record<string, unknown>) => {
      if (props.name) renderedIcons.push(props.name as string)
      return React.createElement('IconMock', props)
    },
    LangSwitcher: (props: Record<string, unknown>) =>
      React.createElement('LangSwitcherMock', props),
  }
})

// Tab routes must include `recall` for the navigator to resolve navigation.
const routes = [
  { name: 'index', key: 'index-key' },
  { name: 'recall', key: 'recall-key' },
  { name: 'nearby', key: 'nearby-key' },
  { name: 'you', key: 'you-key' },
]

function makeProps(activeRoute: string) {
  const index = routes.findIndex((r) => r.name === activeRoute)
  return {
    state: { index, routes },
    navigation: {
      emit: jest.fn(() => ({ defaultPrevented: false })),
      navigate: jest.fn(),
    },
  }
}

function renderNav(gtMd: boolean, activeRoute = 'index') {
  renderedIcons.length = 0
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

describe('AppNav — recall replaces todo in the nav bar (4-B)', () => {
  it.each([
    ['bottom bar (mobile)', false],
    ['sidebar (desktop)', true],
  ])('renders "Recall" label and NOT "To-Try" in the %s', (_label, gtMd) => {
    const renderer = renderNav(gtMd as boolean)
    const labels = renderer.root
      .findAll((n) => typeof n.props.children === 'string')
      .map((n) => n.props.children as string)

    expect(labels).toContain('Recall')
    expect(labels).not.toContain('To-Try')
  })

  it.each([
    ['bottom bar (mobile)', false],
    ['sidebar (desktop)', true],
  ])('uses the `clock` icon (not `bookmark`) for the recall nav entry in the %s', (_label, gtMd) => {
    renderNav(gtMd as boolean)

    expect(renderedIcons).toContain('clock')
    expect(renderedIcons).not.toContain('bookmark')
  })

  it('tapping the Recall label navigates to the `recall` route', () => {
    const props = makeProps('index') as unknown as React.ComponentProps<typeof AppNav> & {
      navigation: { emit: jest.Mock; navigate: jest.Mock }
    }
    mockUseWindowDimensions.mockReturnValue({ width: 390, height: 844 })
    let renderer!: TestRenderer.ReactTestRenderer
    act(() => {
      renderer = TestRenderer.create(React.createElement(AppNav, props))
    })

    // Find the pressable whose subtree contains the 'Recall' text label.
    const pressables = renderer.root.findAll(
      (n) =>
        n.props.accessibilityRole === 'button' &&
        typeof n.props.onPress === 'function' &&
        n.findAll((c) => c.props.children === 'Recall').length > 0,
    )
    expect(pressables.length).toBeGreaterThan(0)
    act(() => {
      pressables[0].props.onPress()
    })
    expect(props.navigation.navigate).toHaveBeenCalledWith('recall')
  })

  it('Recall sits in position 2 (left of FAB) in the bottom bar, Nearby in position 3', () => {
    const renderer = renderNav(false)
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
})
