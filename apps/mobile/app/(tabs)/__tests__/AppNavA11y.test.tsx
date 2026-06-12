/* ============================================================
   Regression — sidebar and tab Pressable elements expose
   accessibilityState.selected so VoiceOver/TalkBack can distinguish
   the active tab from inactive tabs.

   Finding: active sidebar/tab Pressable elements did not expose
   accessibilityState.selected; AT users had no way to know which tab
   was currently active.

   Fix: `accessibilityState={{ selected: on }}` added to the sidebar nav
   Pressable and `accessibilityState={{ selected: active }}` added to
   AnimatedTab's Pressable.
   ============================================================ */

import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { AppNav } from '../_nav'

const mockUseWindowDimensions = jest.fn()
const mockSetLang = jest.fn()

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
  LANGS: [{ code: 'en', label: 'English', native: 'English' }],
}))

jest.mock('@/providers/I18nProvider', () => ({
  useI18n: () => ({
    lang: 'en',
    setLang: mockSetLang,
    t: (key: string) => ({
      free_plan: 'Free',
      log_taste: 'Log a taste',
      nav_recall: 'Recall',
      nav_todo: 'To-Try',
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
    LangSwitcher: (props: Record<string, unknown>) => React.createElement('LangSwitcherMock', props),
  }
})

const routes = [
  { name: 'index', key: 'index-key' },
  { name: 'recall', key: 'recall-key' },
  { name: 'todo', key: 'todo-key' },
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

function renderNav(activeRoute: string, width: number) {
  mockUseWindowDimensions.mockReturnValue({ width, height: 844 })
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

describe('AppNav sidebar — accessibilityState.selected (finding: VoiceOver cannot identify active tab)', () => {
  it('active sidebar nav item has accessibilityState.selected=true', () => {
    // Desktop layout (width >= 769)
    const renderer = renderNav('index', 1024)

    // Find all Pressables with accessibilityRole='button'
    const pressables = renderer.root.findAll(
      (n) =>
        typeof n.type !== 'string' &&
        (n.type?.displayName === 'Pressable' || n.type?.name === 'Pressable') &&
        n.props.accessibilityRole === 'button',
    )

    // At least one sidebar nav Pressable must have selected=true (the active route)
    const selectedOnes = pressables.filter((p) => p.props.accessibilityState?.selected === true)
    expect(selectedOnes.length).toBeGreaterThan(0)
  })

  it('inactive sidebar nav items have accessibilityState.selected=false or absent', () => {
    const renderer = renderNav('index', 1024)

    const pressables = renderer.root.findAll(
      (n) =>
        typeof n.type !== 'string' &&
        (n.type?.displayName === 'Pressable' || n.type?.name === 'Pressable') &&
        n.props.accessibilityRole === 'button',
    )

    // Only one nav item should be selected
    const selectedOnes = pressables.filter((p) => p.props.accessibilityState?.selected === true)
    // There are 4 nav items; exactly 1 should be selected
    expect(selectedOnes.length).toBe(1)
  })
})

describe('AppNav tab bar — accessibilityState.selected (finding: TalkBack cannot identify active tab)', () => {
  it('active AnimatedTab has accessibilityState.selected=true', () => {
    // Mobile layout (width < 769)
    const renderer = renderNav('recall', 390)

    const pressables = renderer.root.findAll(
      (n) =>
        typeof n.type !== 'string' &&
        (n.type?.displayName === 'Pressable' || n.type?.name === 'Pressable') &&
        n.props.accessibilityRole === 'button',
    )

    const selectedOnes = pressables.filter((p) => p.props.accessibilityState?.selected === true)
    expect(selectedOnes.length).toBeGreaterThan(0)
  })

  it('exactly one tab has selected=true in the bottom bar', () => {
    const renderer = renderNav('todo', 390)

    const pressables = renderer.root.findAll(
      (n) =>
        typeof n.type !== 'string' &&
        (n.type?.displayName === 'Pressable' || n.type?.name === 'Pressable') &&
        n.props.accessibilityRole === 'button',
    )

    const selectedOnes = pressables.filter((p) => p.props.accessibilityState?.selected === true)
    // Bottom bar has tabs + FAB; exactly 1 tab selected
    expect(selectedOnes.length).toBe(1)
  })
})
