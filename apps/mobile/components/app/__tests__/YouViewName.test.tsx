/* ============================================================
   Regression tests — YouView nickname edit + fallback display name.

   RISK-02 pin: 'Mina Park' must NEVER appear in the rendered tree
   for a user who has no displayName but has an email address. The
   fallback chain is: displayName → email local-part → Foodie {tail}
   → t('default_name').
   ============================================================ */

import TestRenderer, { act } from 'react-test-renderer'
import YouView from '../YouView'

// Identifiable KeyboardStickyView (the shared mock aliases it to a plain View,
// indistinguishable from any other View). This lets the keyboard test pin that
// the nickname sheet content is actually wrapped so it rides the keyboard.
jest.mock('react-native-keyboard-controller', () => {
  const React = require('react')
  const { View } = require('react-native')
  return {
    KeyboardStickyView: ({ children }: { children: React.ReactNode }) =>
      React.createElement(View, { testID: 'nickname-keyboard-sticky' }, children),
  }
})

const mockPush = jest.fn()
const mockSetLang = jest.fn()
const mockSignOut = jest.fn()
const mockFormatMoney = jest.fn((n: number) => `$${n.toFixed(2)}`)
const mockPatchUser = jest.fn()
const mockUpdateUser = jest.fn()

// Mutable user so individual tests can override it
let mockUser: {
  avatar: string
  displayName: string
  email: string
  phone: string
  plan: string
  warningsEnabled: boolean
  locationEnabled: boolean
} = {
  avatar: '',
  displayName: '',
  email: 'alice@example.com',
  phone: '',
  plan: 'free',
  warningsEnabled: false,
  locationEnabled: false,
}

jest.mock('@yon/shared', () => ({
  LANGS: [{ code: 'en', label: 'English', native: 'English' }],
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
        cancel: 'Cancel',
        default_name: 'Foodie',
        display_name_label: 'Nickname',
        edit_profile: 'Edit nickname',
        invalid_display_name: 'Nickname must be 1–50 characters',
        meh: 'Meh',
        nah: 'Nah',
        pro_plan: 'Pro',
        save: 'Save',
        save_taste: 'Save this taste',
        saved_amt: `${vars?.amt} saved`,
        saved_sub: 'by skipping',
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
    user: mockUser,
    signOut: mockSignOut,
    patchUser: mockPatchUser,
  }),
}))

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

function getAllText(renderer: TestRenderer.ReactTestRenderer): string[] {
  const texts: string[] = []
  renderer.root.findAll((n) => {
    if (typeof n.props.children === 'string') texts.push(n.props.children)
    return false
  })
  return texts
}

describe('YouView display name — Mina Park never renders (RISK-02)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockFormatMoney.mockImplementation((n: number) => `$${n.toFixed(2)}`)
  })

  it('falls back to email local-part when displayName is empty', () => {
    mockUser = { ...mockUser, displayName: '', email: 'alice@example.com' }
    const renderer = renderYouView()
    const texts = getAllText(renderer)
    expect(texts).not.toContain('Mina Park')
    expect(texts).toContain('alice')
  })

  it('skips empty email local-part (e.g. @example.com) and continues to phone fallback', () => {
    mockUser = { ...mockUser, displayName: '', email: '@example.com', phone: '+8613800138000' }
    const renderer = renderYouView()
    const texts = getAllText(renderer)
    // empty local-part must not become the display name
    expect(texts).not.toContain('')
    expect(texts).not.toContain('Mina Park')
    // must reach the phone fallback
    expect(texts.some((t) => t.startsWith('Foodie'))).toBe(true)
  })

  it('falls back to Foodie {phone tail} when displayName and email are both absent', () => {
    mockUser = { ...mockUser, displayName: '', email: '', phone: '+8613800138000' }
    const renderer = renderYouView()
    const texts = getAllText(renderer)
    expect(texts).not.toContain('Mina Park')
    expect(texts.some((t) => t.startsWith('Foodie'))).toBe(true)
  })

  it('falls back to default_name when all fields absent', () => {
    mockUser = { ...mockUser, displayName: '', email: '', phone: '' }
    const renderer = renderYouView()
    const texts = getAllText(renderer)
    expect(texts).not.toContain('Mina Park')
    expect(texts).toContain('Foodie')
  })

  it('uses displayName when set', () => {
    mockUser = { ...mockUser, displayName: 'Kai Zhang', email: 'kai@example.com' }
    const renderer = renderYouView()
    const texts = getAllText(renderer)
    expect(texts).toContain('Kai Zhang')
    expect(texts).not.toContain('Mina Park')
  })
})

describe('YouView nickname edit modal', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockUser = { ...mockUser, displayName: 'Alice', email: 'alice@example.com', phone: '' }
    mockFormatMoney.mockImplementation((n: number) => `$${n.toFixed(2)}`)
    mockUpdateUser.mockResolvedValue({ user: { displayName: 'Alice Edited', warningsEnabled: false } })
    mockPatchUser.mockImplementation(() => {})
  })

  it('edit pencil button opens the modal (input becomes visible)', () => {
    const renderer = renderYouView()
    act(() => {
      renderer.root.findByProps({ testID: 'edit-name-btn' }).props.onPress()
    })
    const input = renderer.root.findByProps({ testID: 'display-name-input' })
    expect(input).toBeTruthy()
  })

  it('save calls updateUser with trimmed displayName', async () => {
    const renderer = renderYouView()
    act(() => {
      renderer.root.findByProps({ testID: 'edit-name-btn' }).props.onPress()
    })
    act(() => {
      renderer.root.findByProps({ testID: 'display-name-input' }).props.onChangeText('  New Name  ')
    })
    await act(async () => {
      await renderer.root.findByProps({ testID: 'save-name-btn' }).props.onPress()
    })
    expect(mockUpdateUser).toHaveBeenCalledWith({ displayName: 'New Name' })
    // patchUser receives whatever the server returned (only displayName in this mock)
    expect(mockPatchUser).toHaveBeenCalledWith(expect.objectContaining({ displayName: 'Alice Edited' }))
  })

  // Regression (#103): the nickname save button reused the taste-record string
  // t('save_taste') = "Save this taste" / "保存这个口味", which is absurd on a
  // username edit sheet. It must use the generic t('save').
  it('save button shows the generic save label, not the taste-record string', () => {
    const renderer = renderYouView()
    act(() => {
      renderer.root.findByProps({ testID: 'edit-name-btn' }).props.onPress()
    })
    const saveBtn = renderer.root.findByProps({ testID: 'save-name-btn' })
    expect(saveBtn.props.children).toBe('Save')
    expect(saveBtn.props.children).not.toBe('Save this taste')
  })

  it('shows error and does not call updateUser for empty input', async () => {
    const renderer = renderYouView()
    act(() => {
      renderer.root.findByProps({ testID: 'edit-name-btn' }).props.onPress()
    })
    act(() => {
      renderer.root.findByProps({ testID: 'display-name-input' }).props.onChangeText('   ')
    })
    // save button should be disabled when input is whitespace-only
    const saveBtn = renderer.root.findByProps({ testID: 'save-name-btn' })
    expect(saveBtn.props.disabled).toBe(true)
    expect(mockUpdateUser).not.toHaveBeenCalled()
  })

  // Regression: the nickname sheet had no keyboard handling, so focusing the
  // input opened the keyboard over the input + save/cancel row. The sheet
  // content must be wrapped in a KeyboardStickyView so it rides the keyboard.
  it('renders the nickname input and save button inside a KeyboardStickyView', () => {
    const renderer = renderYouView()
    act(() => {
      renderer.root.findByProps({ testID: 'edit-name-btn' }).props.onPress()
    })
    const sticky = renderer.root.findByProps({ testID: 'nickname-keyboard-sticky' })
    expect(sticky.findByProps({ testID: 'display-name-input' })).toBeTruthy()
    expect(sticky.findByProps({ testID: 'save-name-btn' })).toBeTruthy()
  })
})
