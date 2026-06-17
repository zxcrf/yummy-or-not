/* ============================================================
   S3c regression — You page "new-record default visibility" row UNHIDES.

   The plan (docs/product/plans/share-and-circles.md head note + §S3c UI):
     "Private mode 的最终归宿在 S3c：…You 页设置项变「新记录默认可见性」。
      S3c 落地前 You 页该行隐藏。"
   and §S3c: "You 页「新记录默认可见性」行取消隐藏（S2 起预留），绑 default_visibility。"

   Today YouView.tsx has a "set_private row removed until S3" placeholder comment
   in place of the row — the row is absent, and there is exactly ONE switch
   (buy-again warnings); location is a switch too, but the private/visibility row
   has none. This test pins that S3c:
     1. RE-ADDS the default-visibility settings row (its label renders), and
     2. BINDS its control to users.default_visibility — toggling it persists via
        updateUser({ defaultVisibility }) and patches the auth user, exactly like
        the warnings/location rows. A row that renders but writes the WRONG field
        (or nothing) must fail this test.

   FAILS today: the row is commented out, so neither the label nor an
   updateUser({ defaultVisibility }) call exists. PASSES once S3c unhides it.
   ============================================================ */

import TestRenderer, { act } from 'react-test-renderer'
import YouView from '../YouView'

const mockSetLang = jest.fn()
const mockSignOut = jest.fn()
const mockFormatMoney = jest.fn((n: number) => `$${n.toFixed(2)}`)
const mockPatchUser = jest.fn()
const mockUpdateUser = jest.fn()

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}))

jest.mock('@yon/shared', () => ({
  LANGS: [
    { code: 'zh', label: 'Chinese', native: '中文' },
    { code: 'en', label: 'English', native: 'English' },
  ],
  updateUser: (...args: unknown[]) => mockUpdateUser(...args),
}))

jest.mock('@/providers/I18nProvider', () => ({
  useI18n: () => ({
    lang: 'zh',
    setLang: mockSetLang,
    formatMoney: mockFormatMoney,
    t: (key: string, vars?: Record<string, string | number>) =>
      (({
        auth_signout: 'Sign out',
        set_location: 'Location reminders',
        set_private: 'Private log',
        // S3c may rename the row; support either key so the test pins BEHAVIOUR
        // (binding to default_visibility) not a specific string.
        set_default_visibility: 'New records default to',
        settings: 'Settings',
        tastes_logged: `${vars?.n} tastes logged`,
      } as Record<string, string>)[key] ?? key),
  }),
}))

// user seeded with default_visibility='private' — the row must reflect & flip it.
const mockUser = {
  avatar: '',
  displayName: 'Mina Park',
  plan: 'free',
  warningsEnabled: false,
  locationEnabled: false,
  defaultVisibility: 'private' as 'private' | 'shared',
}

jest.mock('@/providers/AuthProvider', () => ({
  useAuth: () => ({
    user: mockUser,
    signOut: mockSignOut,
    patchUser: mockPatchUser,
  }),
}))

function renderYouView(): TestRenderer.ReactTestRenderer {
  let renderer!: TestRenderer.ReactTestRenderer
  act(() => {
    renderer = TestRenderer.create(<YouView items={[]} />)
  })
  return renderer
}

describe('YouView default-visibility row (S3c unhide)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockFormatMoney.mockImplementation((n: number) => `$${n.toFixed(2)}`)
    mockUpdateUser.mockResolvedValue({ user: { defaultVisibility: 'shared' } })
    mockPatchUser.mockImplementation(() => {})
  })

  it('renders a default-visibility settings row (no longer hidden behind the S3 comment)', () => {
    const renderer = renderYouView()
    // The row label is one of the visibility-row keys. At least one must render.
    const labels = ['New records default to', 'Private log']
    const found = renderer.root.findAll(
      (n) =>
        String(n.type) === 'Text' &&
        typeof n.props.children === 'string' &&
        labels.includes(n.props.children as string),
    )
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('the visibility control is seeded from user.defaultVisibility and persists via updateUser({ defaultVisibility })', async () => {
    const renderer = renderYouView()

    // The Switch design-system component renders several nodes carrying
    // accessibilityRole="switch"; the interactive one is the node whose onPress
    // is callable. S3c must add a THIRD interactive switch (default-visibility)
    // beyond warnings + location.
    const interactiveSwitches = renderer.root
      .findAll((n) => n.props.accessibilityRole === 'switch')
      .filter((n) => typeof n.props.onPress === 'function')
    expect(interactiveSwitches.length).toBeGreaterThanOrEqual(3)

    // The default-visibility switch is the one seeded OFF for user
    // defaultVisibility='private' whose toggle writes defaultVisibility. Drive
    // each candidate that is currently OFF and find the one that persists
    // defaultVisibility — this pins the BINDING, not a positional guess.
    let wrote = false
    for (const sw of interactiveSwitches) {
      if (sw.props.accessibilityState?.checked !== false) continue
      mockUpdateUser.mockClear()
      mockPatchUser.mockClear()
      // eslint-disable-next-line no-await-in-loop
      await act(async () => {
        await sw.props.onPress()
      })
      const call = mockUpdateUser.mock.calls.find(
        (c) => c[0] && Object.prototype.hasOwnProperty.call(c[0], 'defaultVisibility'),
      )
      if (call) {
        // 'shared' is the "on" value per the plan enum, and the auth user is patched.
        expect(call[0]).toEqual(expect.objectContaining({ defaultVisibility: 'shared' }))
        expect(mockPatchUser).toHaveBeenCalledWith(
          expect.objectContaining({ defaultVisibility: 'shared' }),
        )
        wrote = true
        break
      }
    }
    // Some switch must have been bound to default_visibility (the unhidden row).
    expect(wrote).toBe(true)
  })
})
