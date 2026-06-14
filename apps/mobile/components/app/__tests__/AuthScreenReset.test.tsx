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
import * as Clipboard from 'expo-clipboard'
import AuthScreen, { submitReset, maskEmail } from '../AuthScreen'

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
  // Faithful mini-parser mirroring the real extractResetToken (URL or bare hex)
  // so the deep-link + clipboard-paste paths can be exercised without the real
  // shared barrel (which the rest of this mock deliberately stubs out).
  extractResetToken: (input: string | null | undefined) => {
    if (!input) return null
    const v = input.trim()
    if (/^[0-9a-fA-F]{64}$/.test(v)) return v
    // mirror the real parser: reset-password must be the path segment
    const m = /(?:\/\/|\/)reset-password\?(?:[^#]*&)?token=([0-9a-fA-F]{64})(?:[&#]|$)/i.exec(v)
    return m ? m[1] : null
  },
}))

// Deep-link capture hook — controllable per test. Defaults to "no deep link".
const mockUseResetTokenCapture = jest.fn<string | null, []>(() => null)
jest.mock('../useResetTokenCapture', () => ({
  useResetTokenCapture: () => mockUseResetTokenCapture(),
}))

// Clipboard — the [粘贴] button reads it on explicit tap.
jest.mock('expo-clipboard', () => ({ getStringAsync: jest.fn() }))

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
  mockUseResetTokenCapture.mockReturnValue(null) // clearAllMocks keeps impl; reset the default
})

/** Find the TextInput our Input stub renders for a given label. */
function inputForLabel(renderer: TestRenderer.ReactTestRenderer, label: string) {
  return renderer.root.findAll((n) => n.props.testID === `input-${label}`)
}

/** Find rendered Text nodes whose content equals `key` (i18n identity mock). */
function hasText(renderer: TestRenderer.ReactTestRenderer, key: string): boolean {
  return renderer.root.findAll((n) => n.type === Text && n.props.children === key).length > 0
}

/** Find Buttons (our Pressable stub) by label, matching BOTH primary Buttons
 *  (bare-string children) and ghost/tab Buttons (Text-wrapped children). */
function pressBtn(renderer: TestRenderer.ReactTestRenderer, label: string) {
  return renderer.root.findAll((node) => {
    if (typeof node.props.onPress !== 'function') return false
    const kids = Array.isArray(node.props.children) ? node.props.children : [node.props.children]
    if (kids.some((k) => k === label)) return true
    const texts: string[] = []
    node.findAll((n) => {
      if (n.type === Text && typeof n.props.children === 'string') texts.push(n.props.children)
      return false
    })
    return texts.includes(label)
  })
}

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

const HEX64 = 'a'.repeat(64)

describe('reset deep link (cross-device bridge)', () => {
  it('opens straight to the new-password step with the token detected, skipping the email step', () => {
    // Simulate the app being opened from yummyornot://reset-password?token=…
    mockUseResetTokenCapture.mockReturnValue(HEX64)

    const renderer = mount()
    mounted.push(renderer)

    // The deep link forces the email habit + jumps to the reset step: the
    // "code detected" chip shows and we are NOT asking the user to send an
    // email or paste a token.
    expect(hasText(renderer, 'auth_reset_token_detected')).toBe(true)
    expect(pressBtn(renderer, 'auth_reset_submit').length).toBeGreaterThan(0)
    // The manual token field is hidden when the token arrived via deep link.
    expect(inputForLabel(renderer, 'auth_reset_token_label')).toHaveLength(0)
    // Did not get stuck on the send-email step.
    expect(pressBtn(renderer, 'auth_reset_send')).toHaveLength(0)
  })

  it('submits the deep-link token with the user-supplied email (reset-verify binds both)', async () => {
    // Deep-link entry knows the token but NOT the email — reset-verify binds the
    // token to the email, so the user must supply it. Pins that the email field
    // is present on deep-link entry and flows into the verify payload (a regression
    // here = the whole deep-link reset silently fails with an empty email).
    mockUseResetTokenCapture.mockReturnValue(HEX64)

    const renderer = mount()
    mounted.push(renderer)

    act(() => {
      inputForLabel(renderer, 'auth_email_label')[0].props.onChangeText('deep@x.com')
    })
    act(() => {
      inputForLabel(renderer, 'auth_reset_new_password_label')[0].props.onChangeText('brandnew8')
    })
    await act(async () => { pressBtn(renderer, 'auth_reset_submit')[0].props.onPress() })

    expect(mockVerifyPasswordReset).toHaveBeenCalledWith({
      email: 'deep@x.com',
      token: HEX64,
      newPassword: 'brandnew8',
    })
  })
})

describe('reset clipboard paste (desktop→phone bridge)', () => {
  it('fills the token field by parsing a reset deep link copied to the clipboard', async () => {
    // Clipboard holds the FULL deep link the user copied from a desktop email.
    ;(Clipboard.getStringAsync as jest.Mock).mockResolvedValue(
      `yummyornot://reset-password?token=${HEX64}`,
    )

    const renderer = mount()
    mounted.push(renderer)

    // email tab → forgot password → send email (→ check-inbox) → I have the code
    act(() => { pressBtn(renderer, 'auth_email_tab')[0].props.onPress() })
    act(() => { pressBtn(renderer, 'auth_forgot_password')[0].props.onPress() })
    await act(async () => { pressBtn(renderer, 'auth_reset_send')[0].props.onPress() })
    act(() => { pressBtn(renderer, 'auth_reset_have_code')[0].props.onPress() })

    // The token field starts empty.
    expect(inputForLabel(renderer, 'auth_reset_token_label')[0].props.value).toBe('')

    // Tap [paste]: the clipboard deep link is parsed down to the bare token.
    await act(async () => { pressBtn(renderer, 'auth_reset_paste')[0].props.onPress() })

    expect(Clipboard.getStringAsync).toHaveBeenCalledTimes(1)
    expect(inputForLabel(renderer, 'auth_reset_token_label')[0].props.value).toBe(HEX64)
  })
})

describe('maskEmail (check-inbox echo)', () => {
  it('masks the local part but keeps the first char and the domain', () => {
    expect(maskEmail('alice@example.com')).toBe('a••••@example.com')
    expect(maskEmail('a@x.com')).toBe('a•@x.com')
  })
  it('returns the input unchanged when there is no local part to mask', () => {
    expect(maskEmail('not-an-email')).toBe('not-an-email')
  })
})
