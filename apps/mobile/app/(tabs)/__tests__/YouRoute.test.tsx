/* ============================================================
   Regression test — You route language switcher ownership.

   User feedback: the You route rendered a red language switcher above
   the profile content. The language control now belongs inside YouView's
   profile row, so this route wrapper must not add its own switcher.
   ============================================================ */

import TestRenderer, { act } from 'react-test-renderer'
import YouRoute from '../you'

const mockUseTastes = jest.fn(() => [])
const mockYouView = jest.fn((props: { items: unknown[] }) => {
  const React = require('react')
  return React.createElement('YouViewMock', props)
})
const mockLangSwitcher = jest.fn((props: Record<string, unknown>) => {
  const React = require('react')
  return React.createElement('LangSwitcherMock', props)
})

jest.mock('../_screen', () => ({
  Screen: ({ children }: { children: React.ReactNode }) => {
    const React = require('react')
    return React.createElement('ScreenMock', null, children)
  },
}))

jest.mock('../_useTastes', () => ({
  useTastes: () => mockUseTastes(),
}))

jest.mock('@/components/app/YouView', () => ({
  __esModule: true,
  default: (props: { items: unknown[] }) => mockYouView(props),
}))

jest.mock('@/components/ds', () => ({
  LangSwitcher: (props: Record<string, unknown>) => mockLangSwitcher(props),
}))

jest.mock('@yon/shared', () => ({
  LANGS: [{ code: 'zh', label: 'Chinese', native: 'Chinese' }],
}))

jest.mock('@/providers/I18nProvider', () => ({
  useI18n: () => ({ lang: 'zh', setLang: jest.fn() }),
}))

describe('YouRoute', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('does not render its own header language switcher', () => {
    act(() => {
      TestRenderer.create(<YouRoute />)
    })

    expect(mockUseTastes).toHaveBeenCalled()
    expect(mockYouView).toHaveBeenCalledWith({ items: [] })
    expect(mockLangSwitcher).not.toHaveBeenCalled()
  })
})
