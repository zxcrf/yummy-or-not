/* ============================================================
   Password-reset entry + verify-step payload on AuthScreen.

   User-level feedback: a user lost their saved password after a
   signing-key change forced an app reinstall, with no in-app way to
   recover. This pins the two things that fix must keep working:

   1. A "忘记密码？" (auth_forgot_password) entry is REACHABLE from the
      email login form — the user can actually start a reset.
   2. The verify step submits exactly { email, token, newPassword } to
      the API — a regression in the wired-up fields (e.g. sending the
      raw token in the wrong slot, or dropping newPassword) is caught.

   submitReset is the exported decision/side-effect the verify button
   runs; testing it directly pins the payload without depending on the
   full screen's heavy native dependency surface.
   ============================================================ */

import TestRenderer, { act } from 'react-test-renderer'
import { Text } from 'react-native'
import AuthScreen, { submitReset } from '../AuthScreen'

// ── capture the shared API client calls ──────────────────────────────────────
const mockVerifyPasswordReset = jest.fn().mockResolvedValue({ ok: true })
const mockRequestPasswordReset = jest.fn().mockResolvedValue({ ok: true })

jest.mock('@yon/shared', () => ({
  LANGS: [],
  loginEmail: jest.fn(),
  registerEmail: jest.fn(),
  oauthStartUrl: jest.fn(),
  requestOtp: jest.fn(),
  verifyOtp: jest.fn(),
  requestPasswordReset: (...args: unknown[]) => mockRequestPasswordReset(...args),
  verifyPasswordReset: (...args: unknown[]) => mockVerifyPasswordReset(...args),
  setAuthToken: jest.fn(),
}))

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
}))

jest.mock('@/providers/I18nProvider', () => ({
  useI18n: () => ({
    t: (key: string) => key, // identity → assert on i18n keys
    lang: 'en',
    setLang: jest.fn(),
  }),
}))

jest.mock('@/providers/AuthProvider', () => ({
  useAuth: () => ({ providers: [], refresh: jest.fn(), user: { warningsEnabled: true } }),
}))

// DS stubs that forward the props the test drives: Button renders its children
// (so we can find it by label) and exposes onPress; Input forwards label +
// onChangeText so we can type into a specific field.
jest.mock('@/components/ds', () => {
  const React = require('react')
  const { Pressable, TextInput, View, Text } = require('react-native')
  return {
    Icon: () => null,
    IconButton: () => null,
    LangSwitcher: () => null,
    Button: ({ children, onPress, disabled }: { children: React.ReactNode; onPress?: () => void; disabled?: boolean }) =>
      React.createElement(Pressable, { onPress, disabled }, children),
    Input: ({ label, value, onChangeText }: { label?: string; value?: string; onChangeText?: (t: string) => void }) =>
      React.createElement(
        View,
        null,
        React.createElement(Text, null, label),
        React.createElement(TextInput, { testID: `input-${label}`, value, onChangeText }),
      ),
  }
})

jest.mock('expo-web-browser', () => ({ openAuthSessionAsync: jest.fn() }))

function mount(): TestRenderer.ReactTestRenderer {
  let renderer!: TestRenderer.ReactTestRenderer
  act(() => {
    renderer = TestRenderer.create(<AuthScreen />)
  })
  return renderer
}

/** Find a Pressable (our Button stub) whose rendered text matches `label`. */
function pressableWithText(renderer: TestRenderer.ReactTestRenderer, label: string) {
  return renderer.root.findAll((node) => {
    if (typeof node.props.onPress !== 'function') return false
    const texts: string[] = []
    node.findAll((n) => {
      if (n.type === Text && typeof n.props.children === 'string') texts.push(n.props.children)
      return false
    })
    return texts.includes(label)
  })
}

const mounted: TestRenderer.ReactTestRenderer[] = []
afterEach(() => {
  act(() => { mounted.forEach((r) => r.unmount()) })
  mounted.length = 0
  jest.clearAllMocks()
})

describe('AuthScreen forgot-password entry', () => {
  it('is NOT shown in the default phone tab, but IS reachable from the email login form', () => {
    const renderer = mount()
    mounted.push(renderer)

    // Default tab is phone — no forgot-password entry yet.
    expect(pressableWithText(renderer, 'auth_forgot_password')).toHaveLength(0)

    // Switch to the email tab (login mode is the default there).
    act(() => {
      pressableWithText(renderer, 'auth_email_tab')[0].props.onPress()
    })

    // The "忘记密码？" entry now renders.
    expect(pressableWithText(renderer, 'auth_forgot_password').length).toBeGreaterThan(0)
  })

  it('opens the reset view (reset title appears) when the entry is pressed', () => {
    const renderer = mount()
    mounted.push(renderer)

    act(() => {
      pressableWithText(renderer, 'auth_email_tab')[0].props.onPress()
    })
    act(() => {
      pressableWithText(renderer, 'auth_forgot_password')[0].props.onPress()
    })

    const titles: string[] = []
    renderer.root.findAll((n) => {
      if (n.type === Text && n.props.children === 'auth_reset_title') titles.push('x')
      return false
    })
    expect(titles.length).toBeGreaterThan(0)
  })
})

describe('submitReset (the verify-step side effect)', () => {
  it('submits exactly { email, token, newPassword } and signals success', async () => {
    const onSuccess = jest.fn()
    await submitReset(
      { email: 'a@x.com', token: 'emailed-token', newPassword: 'brandnew8' },
      onSuccess,
    )

    expect(mockVerifyPasswordReset).toHaveBeenCalledTimes(1)
    expect(mockVerifyPasswordReset).toHaveBeenCalledWith({
      email: 'a@x.com',
      token: 'emailed-token',
      newPassword: 'brandnew8',
    })
    expect(onSuccess).toHaveBeenCalledTimes(1)
  })

  it('does NOT signal success when the API rejects (bad token)', async () => {
    mockVerifyPasswordReset.mockRejectedValueOnce(new Error('bad_token'))
    const onSuccess = jest.fn()

    await expect(
      submitReset({ email: 'a@x.com', token: 'bad', newPassword: 'brandnew8' }, onSuccess),
    ).rejects.toThrow('bad_token')
    expect(onSuccess).not.toHaveBeenCalled()
  })
})
