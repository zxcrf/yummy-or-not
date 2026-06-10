/* ============================================================
   Regression tests — You page language switcher placement.

   User feedback: the You page had an extra red language button above
   the profile row and another blue language button under the name. The
   intended page has one language control, placed in the profile row and
   rendered as a flag.
   ============================================================ */

import TestRenderer, { act } from 'react-test-renderer'
import YouView from '../YouView'

const mockSetLang = jest.fn()
const mockSignOut = jest.fn()

jest.mock('@yon/shared', () => ({
  LANGS: [
    { code: 'zh', label: 'Chinese', native: '中文' },
    { code: 'en', label: 'English', native: 'English' },
  ],
}))

jest.mock('@/providers/I18nProvider', () => ({
  useI18n: () => ({
    lang: 'zh',
    setLang: mockSetLang,
    formatMoney: (n: number) => `$${n.toFixed(2)}`,
    t: (key: string, vars?: Record<string, string | number>) => ({
      auth_signout: 'Sign out',
      meh: 'Meh',
      nah: 'Nah',
      pro_plan: 'Pro',
      saved_amt: `${vars?.amt} saved`,
      saved_sub: 'by skipping repeat nah buys',
      set_location: 'Location reminders',
      set_private: 'Private log',
      set_warnings: 'Buy-again warnings',
      settings: 'Settings',
      tastes_logged: `${vars?.n} tastes logged`,
      yum: 'Yum',
    }[key] ?? key),
  }),
}))

jest.mock('@/providers/AuthProvider', () => ({
  useAuth: () => ({
    user: {
      avatar: '',
      displayName: 'Mina Park',
      plan: 'free',
    },
    signOut: mockSignOut,
  }),
}))

function renderYouView(): TestRenderer.ReactTestRenderer {
  let renderer!: TestRenderer.ReactTestRenderer
  act(() => {
    renderer = TestRenderer.create(<YouView items={[]} />)
  })
  return renderer
}

describe('YouView language switcher', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('renders one language switcher in flag mode', () => {
    const renderer = renderYouView()
    const switchers = renderer.root.findAllByProps({ triggerMode: 'flag' })

    expect(switchers).toHaveLength(1)
    expect(switchers[0].props.align).toBe('right')
  })

  it('does not render the old label-style language switcher under the profile', () => {
    const renderer = renderYouView()

    expect(renderer.root.findAllByProps({ triggerMode: 'label' })).toHaveLength(0)
    expect(
      renderer.root.findAll(
        (node) => node.props.children === '中文' || node.props.children === 'English',
      ),
    ).toHaveLength(0)
  })
})
