/* ============================================================
   Regression tests — YouView nickname edit + fallback display name.

   RISK-02 pin: 'Mina Park' must NEVER appear in the rendered tree
   for a user who has no displayName but has an email address. The
   fallback chain is: displayName → email local-part → Foodie {tail}
   → t('default_name').
   ============================================================ */

import TestRenderer, { act } from 'react-test-renderer'
import YouView from '../YouView'

// Full-screen editor uses KeyboardAwareScrollView (not KeyboardStickyView).
jest.mock('react-native-keyboard-controller', () => {
  const React = require('react')
  const { View } = require('react-native')
  return {
    KeyboardAwareScrollView: ({ children, ...props }: { children: React.ReactNode; [key: string]: unknown }) =>
      React.createElement(View, { testID: 'kb-aware-scroll', ...props }, children),
  }
})

// EditActionHeader calls useSafeAreaInsets(), which throws without a
// SafeAreaProvider under jest-expo. Stub zero insets.
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 34, left: 0, right: 0 }),
}))

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
        discard_changes_body: 'Your changes will be lost.',
        discard_changes_title: 'Discard changes?',
        discard_confirm: 'Discard',
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

// Track mounted renderers for afterEach cleanup (async-leak prevention).
const mountedRenderers: TestRenderer.ReactTestRenderer[] = []

async function renderYouView(): Promise<TestRenderer.ReactTestRenderer> {
  let renderer!: TestRenderer.ReactTestRenderer
  await act(async () => {
    renderer = TestRenderer.create(<YouView items={[]} />)
  })
  mountedRenderers.push(renderer)
  return renderer
}

afterEach(() => {
  act(() => {
    mountedRenderers.forEach((r) => r.unmount())
  })
  mountedRenderers.length = 0
})

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

  it('falls back to email local-part when displayName is empty', async () => {
    mockUser = { ...mockUser, displayName: '', email: 'alice@example.com' }
    const renderer = await renderYouView()
    const texts = getAllText(renderer)
    expect(texts).not.toContain('Mina Park')
    expect(texts).toContain('alice')
  })

  it('skips empty email local-part (e.g. @example.com) and continues to phone fallback', async () => {
    mockUser = { ...mockUser, displayName: '', email: '@example.com', phone: '+8613800138000' }
    const renderer = await renderYouView()
    const texts = getAllText(renderer)
    // empty local-part must not become the display name
    expect(texts).not.toContain('')
    expect(texts).not.toContain('Mina Park')
    // must reach the phone fallback
    expect(texts.some((t) => t.startsWith('Foodie'))).toBe(true)
  })

  it('falls back to Foodie {phone tail} when displayName and email are both absent', async () => {
    mockUser = { ...mockUser, displayName: '', email: '', phone: '+8613800138000' }
    const renderer = await renderYouView()
    const texts = getAllText(renderer)
    expect(texts).not.toContain('Mina Park')
    expect(texts.some((t) => t.startsWith('Foodie'))).toBe(true)
  })

  it('falls back to default_name when all fields absent', async () => {
    mockUser = { ...mockUser, displayName: '', email: '', phone: '' }
    const renderer = await renderYouView()
    const texts = getAllText(renderer)
    expect(texts).not.toContain('Mina Park')
    expect(texts).toContain('Foodie')
  })

  it('uses displayName when set', async () => {
    mockUser = { ...mockUser, displayName: 'Kai Zhang', email: 'kai@example.com' }
    const renderer = await renderYouView()
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

  it('edit pencil button opens the modal — input and save button are visible', async () => {
    const renderer = await renderYouView()
    act(() => {
      renderer.root.findByProps({ testID: 'edit-name-btn' }).props.onPress()
    })
    expect(renderer.root.findByProps({ testID: 'display-name-input' })).toBeTruthy()
    expect(renderer.root.findByProps({ testID: 'save-name-btn' })).toBeTruthy()

    // Keyboard contract: the field/cursor stay above the keyboard via
    // KeyboardAwareScrollView (16dp margin + safe-area-aware resting pad).
    // Regression guard for accidental prop removal (insets.bottom mocked to 34).
    const kb = renderer.root.findByProps({ testID: 'kb-aware-scroll' })
    expect(kb.props.bottomOffset).toBe(16)
    expect(kb.props.keyboardShouldPersistTaps).toBe('handled')
    expect(kb.props.keyboardDismissMode).toBe('interactive')
    expect(kb.props.contentContainerStyle.paddingBottom).toBe(50)
  })

  it('save calls updateUser with trimmed displayName', async () => {
    const renderer = await renderYouView()
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
  it('save button shows the generic save label, not the taste-record string', async () => {
    const renderer = await renderYouView()
    act(() => {
      renderer.root.findByProps({ testID: 'edit-name-btn' }).props.onPress()
    })
    const saveBtn = renderer.root.findByProps({ testID: 'save-name-btn' })
    expect(saveBtn.props.children).toBe('Save')
    expect(saveBtn.props.children).not.toBe('Save this taste')
  })

  it('shows error and does not call updateUser for empty input', async () => {
    const renderer = await renderYouView()
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

  // Full-screen pattern: no KeyboardStickyView wrapper; input lives in
  // KeyboardAwareScrollView instead (matches AddModal post-ADR-0001).
  // Cancel button is reachable via cancelTestID="cancel-name-btn" on EditActionHeader.
  it('dirty cancel → ConfirmSheet appears; confirming it closes the editor', async () => {
    const renderer = await renderYouView()
    act(() => {
      renderer.root.findByProps({ testID: 'edit-name-btn' }).props.onPress()
    })
    // Make the input dirty (different from the seeded 'Alice')
    act(() => {
      renderer.root.findByProps({ testID: 'display-name-input' }).props.onChangeText('Alice Modified')
    })
    // Cancel via the header cancel button — dirty guard intercepts
    act(() => {
      renderer.root.findByProps({ testID: 'cancel-name-btn' }).props.onPress()
    })
    // ConfirmSheet should now be visible
    expect(renderer.root.findByProps({ testID: 'youview-cancel-confirm' })).toBeTruthy()
    // Pressing the confirm button closes everything
    act(() => {
      renderer.root.findByProps({ testID: 'youview-cancel-confirm-confirm' }).props.onPress()
    })
    // editor closed — display-name-input is gone
    expect(() => renderer.root.findByProps({ testID: 'display-name-input' })).toThrow()
  })

  it('non-dirty cancel closes the editor immediately with no ConfirmSheet', async () => {
    const renderer = await renderYouView()
    act(() => {
      renderer.root.findByProps({ testID: 'edit-name-btn' }).props.onPress()
    })
    // Input is seeded with 'Alice' (same as mockUser.displayName) → not dirty
    act(() => {
      renderer.root.findByProps({ testID: 'cancel-name-btn' }).props.onPress()
    })
    // Editor should be closed immediately with no confirm sheet
    expect(() => renderer.root.findByProps({ testID: 'display-name-input' })).toThrow()
    expect(() => renderer.root.findByProps({ testID: 'youview-cancel-confirm' })).toThrow()
  })
})
