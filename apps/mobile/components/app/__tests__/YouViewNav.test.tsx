/* ============================================================
   Regression tests — YouView savings card + tastes_logged count navigation.

   BUG-04 closure: pressing the savings card must push '/(tabs)/stats';
   pressing the tastes-logged count must push '/(tabs)'.
   ============================================================ */

import TestRenderer, { act } from 'react-test-renderer'
import YouView from '../YouView'

const mockPush = jest.fn()
const mockSetLang = jest.fn()
const mockSignOut = jest.fn()
const mockFormatMoney = jest.fn((n: number) => `$${n.toFixed(2)}`)
const mockPatchUser = jest.fn()
const mockUpdateUser = jest.fn()

jest.mock('@yon/shared', () => ({
  LANGS: [
    { code: 'zh', label: 'Chinese', native: '中文' },
    { code: 'en', label: 'English', native: 'English' },
  ],
  updateUser: (...args: unknown[]) => mockUpdateUser(...args),
}))

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
}))

jest.mock('@/providers/I18nProvider', () => ({
  useI18n: () => ({
    lang: 'en',
    setLang: mockSetLang,
    formatMoney: mockFormatMoney,
    t: (key: string, vars?: Record<string, string | number>) => {
      const map: Record<string, string> = {
        auth_signout: 'Sign out',
        default_name: 'Foodie',
        edit_profile: 'Edit nickname',
        display_name_label: 'Nickname',
        invalid_display_name: 'Invalid name',
        meh: 'Meh',
        nah: 'Nah',
        pro_plan: 'Pro',
        saved_amt: `${vars?.amt} saved`,
        saved_sub: 'by skipping repeat nah buys',
        set_location: 'Location',
        set_warnings: 'Warnings',
        settings: 'Settings',
        tag_manage: 'Tag library',
        tastes_logged: `${vars?.n} tastes logged`,
        yum: 'Yum',
      }
      return map[key] ?? key
    },
  }),
}))

jest.mock('@/providers/AuthProvider', () => ({
  useAuth: () => ({
    user: { avatar: '', displayName: '', email: 'user@example.com', phone: '', plan: 'free', warningsEnabled: false, locationEnabled: false },
    signOut: mockSignOut,
    patchUser: mockPatchUser,
  }),
}))

// Stub _useTags so TagManageView / YouView tag fetch doesn't run
jest.mock('@/app/(tabs)/_useTags', () => ({
  useTags: () => ({ tags: [], loading: false }),
  invalidateTagsCache: jest.fn(),
}))

function renderYouView(): TestRenderer.ReactTestRenderer {
  let renderer!: TestRenderer.ReactTestRenderer
  act(() => {
    renderer = TestRenderer.create(<YouView items={[]} />)
  })
  return renderer
}

describe('YouView navigation — savings card + tastes-logged count', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockFormatMoney.mockImplementation((n: number) => `$${n.toFixed(2)}`)
  })

  it('savings card press pushes to /(tabs)/stats', () => {
    const renderer = renderYouView()
    const btn = renderer.root.findByProps({ testID: 'savings-card-btn' })
    act(() => {
      btn.props.onPress()
    })
    expect(mockPush).toHaveBeenCalledWith('/(tabs)/stats')
  })

  it('tastes-logged count press pushes to /(tabs)', () => {
    const renderer = renderYouView()
    const btn = renderer.root.findByProps({ testID: 'tastes-logged-btn' })
    act(() => {
      btn.props.onPress()
    })
    expect(mockPush).toHaveBeenCalledWith('/(tabs)')
  })
})
