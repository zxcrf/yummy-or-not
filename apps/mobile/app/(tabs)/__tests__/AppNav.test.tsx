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

const mockUseMedia = jest.fn(() => ({ gtMd: true }))
const mockSetLang = jest.fn()
const mockLangSwitcher = jest.fn((props: Record<string, unknown>) =>
  React.createElement('LangSwitcherMock', props),
)

jest.mock('expo-router', () => ({
  Tabs: () => null,
}))

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}))

jest.mock('tamagui', () => {
  const React = require('react')
  return {
    Text: ({ children, ...props }: { children?: React.ReactNode }) =>
      React.createElement('Text', props, children),
    View: ({ children, ...props }: { children?: React.ReactNode }) =>
      React.createElement('View', props, children),
    useMedia: () => mockUseMedia(),
  }
})

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
      nav_stats: 'Stats',
      nav_you: 'You',
      your_tastes: 'Your tastes',
    }[key] ?? key),
  }),
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
  { name: 'add', key: 'add-key' },
  { name: 'stats', key: 'stats-key' },
  { name: 'you', key: 'you-key' },
]

function renderNav(activeRoute: string) {
  const index = routes.findIndex((route) => route.name === activeRoute)
  const props = {
    state: { index, routes },
    navigation: {
      emit: jest.fn(() => ({ defaultPrevented: false })),
      navigate: jest.fn(),
    },
  }

  act(() => {
    TestRenderer.create(
      React.createElement(AppNav, props as unknown as React.ComponentProps<typeof AppNav>),
    )
  })
}

describe('AppNav desktop language switcher', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockUseMedia.mockReturnValue({ gtMd: true })
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
        tone: '$candyPink',
        value: 'zh',
      }),
    )
  })
})
