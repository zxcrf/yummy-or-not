/* ============================================================
   YUMMY OR NOT — AuthScreen (plain RN + theme, no Tamagui)
   RN port of the web signed-out gate. Two onboarding habits side by
   side:
     • Phone + SMS code  (domestic / China default)
     • Email + password  (international)
   Plus social logins (WeChat / Google / Apple) when configured server-
   side. On success it calls useAuth().refresh() and the gate swaps in
   the app.
   ============================================================ */

import React, { useState, useRef } from 'react'
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { KeyboardAvoidingView } from 'react-native-keyboard-controller'
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated'

import * as WebBrowser from 'expo-web-browser'
import {
  LANGS,
  loginEmail,
  oauthStartUrl,
  registerEmail,
  requestOtp,
  requestPasswordReset,
  setAuthToken,
  verifyOtp,
  verifyPasswordReset,
  type AuthResponse,
  type ProviderStatus,
  type RedeemError,
} from '@yon/shared'

import { Button, Icon, Input, LangSwitcher } from '@/components/ds'
import { colors, radius, space, Text, usePressScale } from '@/theme'
import { useAuth } from '@/providers/AuthProvider'
import { useI18n } from '@/providers/I18nProvider'

type Method = 'phone' | 'email'

/** Map a server error code → an i18n key. */
function errKey(code: string): string {
  const map: Record<string, string> = {
    invalid_phone: 'auth_err_invalid_phone',
    bad_code: 'auth_err_bad_code',
    invalid_input: 'auth_err_bad_code',
    invalid_email: 'auth_err_invalid_email',
    weak_password: 'auth_err_weak_password',
    email_taken: 'auth_err_email_taken',
    invalid_credentials: 'auth_err_invalid_credentials',
    provider_unavailable: 'auth_err_provider_unavailable',
    invalid_code: 'auth_err_invalid_code',
    code_expired: 'auth_err_code_expired',
    code_exhausted: 'auth_err_code_exhausted',
    already_redeemed: 'auth_err_already_redeemed',
    bad_token: 'auth_err_bad_token',
  }
  return map[code] ?? 'auth_err_generic'
}

/**
 * When a sign-up supplied a promo code that the server could NOT redeem (e.g. it
 * was exhausted in the validate→redeem race), the account is still created on
 * free. Return the error to notify the user about; null when there's nothing to
 * surface (code applied, or no code given). The caller must act on a non-null
 * result — silently dropping the user to free is the bug this guards against.
 */
export function promoNotice(res: AuthResponse): RedeemError | null {
  return res.promo && !res.promo.ok ? res.promo.error : null
}

/**
 * Surface a failed sign-up promo to the user via an Alert; no-op when the code
 * applied or none was supplied. Split out from submit() so the side effect (the
 * Alert call + message wiring) is unit-testable, not just the decision.
 */
export function notifyPromo(res: AuthResponse, t: (k: string) => string): void {
  const notice = promoNotice(res)
  if (notice) Alert.alert(t('auth_promo_not_applied'), t(errKey(notice)))
}

/**
 * Open an OAuth start URL via the in-app browser and wait for the native
 * deep-link callback. The API callback route redirects to
 *   yummyornot://auth/callback?token=<token>   (success)
 *   yummyornot://auth/callback?auth_error=<reason>  (failure)
 * openAuthSessionAsync intercepts the redirect when the URL matches the app
 * scheme and returns it without navigating away, so we can extract the token.
 */
async function handleOAuth(
  url: string,
  onToken: (token: string) => Promise<void>,
  onError: (reason: string) => void,
): Promise<void> {
  const redirectUrl = 'yummyornot://auth/callback'
  const result = await WebBrowser.openAuthSessionAsync(url, redirectUrl)
  if (result.type !== 'success') return
  const parsed = new URL(result.url)
  const token = parsed.searchParams.get('token')
  const authError = parsed.searchParams.get('auth_error')
  if (token) {
    await onToken(token)
  } else if (authError) {
    onError(authError)
  }
}

export default function AuthScreen() {
  const { t, lang, setLang } = useI18n()
  const { providers, refresh } = useAuth()

  const [method, setMethod] = useState<Method>('phone')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: '#fff6e6' }}
      behavior="padding"
    >
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.inner}>
          {/* lang switcher */}
          <View style={styles.langRow}>
            <LangSwitcher
              value={lang}
              onChange={setLang}
              languages={LANGS}
              align="right"
              tone={colors.candyPink}
            />
          </View>

          {/* brand */}
          <View style={styles.brand}>
            <Icon name="heart" size={48} color="#ff2e88" />
            <Text style={styles.brandTitle}>
              {'yummy '}
              <Text style={styles.brandOr}>or</Text>
              {' not'}
            </Text>
            <Text style={styles.brandTagline}>{t('auth_tagline')}</Text>
          </View>

          {/* card */}
          <View style={styles.card}>
            {/* method toggle */}
            <View style={styles.methodToggle}>
              <MethodTab
                active={method === 'phone'}
                onPress={() => {
                  setMethod('phone')
                  setError(null)
                }}
                label={t('auth_phone_tab')}
              />
              <MethodTab
                active={method === 'email'}
                onPress={() => {
                  setMethod('email')
                  setError(null)
                }}
                label={t('auth_email_tab')}
              />
            </View>

            {method === 'phone' ? (
              <PhoneForm busy={busy} setBusy={setBusy} setError={setError} onDone={refresh} />
            ) : (
              <EmailForm busy={busy} setBusy={setBusy} setError={setError} onDone={refresh} />
            )}

            {error ? (
              <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(150)}>
                <View style={styles.errorBox}>
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              </Animated.View>
            ) : null}

            {/* social logins */}
            <SocialButtons
              providers={providers}
              method={method}
              t={t}
              setError={setError}
              onDone={refresh}
            />
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

/* ── tab (usePressScale: 0.95 scale + 0.8 opacity) ──────────────────── */
function MethodTab({
  active,
  onPress,
  label,
}: {
  active: boolean
  onPress: () => void
  label: string
}) {
  const press = usePressScale({ toScale: 0.95, toOpacity: 0.8 })

  return (
    <Pressable
      accessibilityRole="button"
      onPressIn={() => { press.onPressIn() }}
      onPressOut={() => { press.onPressOut() }}
      onPress={onPress}
      style={{ flex: 1 }}
    >
      <Animated.View
        style={[
          styles.methodTab,
          active ? styles.methodTabActive : styles.methodTabInactive,
          press.animatedStyle,
        ]}
      >
        <Text style={styles.methodTabLabel}>{label}</Text>
      </Animated.View>
    </Pressable>
  )
}

/* ── phone (domestic) ──────────────────────────────────────────────────────── */
function PhoneForm({
  busy,
  setBusy,
  setError,
  onDone,
}: {
  busy: boolean
  setBusy: (b: boolean) => void
  setError: (e: string | null) => void
  onDone: () => Promise<void>
}) {
  const { t } = useI18n()
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [sent, setSent] = useState(false)
  const [devCode, setDevCode] = useState<string | null>(null)

  const send = async () => {
    setError(null)
    setBusy(true)
    try {
      const { devCode } = await requestOtp(phone)
      setSent(true)
      setDevCode(devCode ?? null)
    } catch (e) {
      setError(t(errKey((e as Error).message)))
    } finally {
      setBusy(false)
    }
  }

  const verify = async () => {
    setError(null)
    setBusy(true)
    try {
      await verifyOtp(phone, code)
      await onDone()
    } catch (e) {
      setError(t(errKey((e as Error).message)))
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={styles.formGap}>
      <Input
        label={t('auth_phone_label')}
        keyboardType="phone-pad"
        autoComplete="tel"
        placeholder={t('auth_phone_ph')}
        value={phone}
        onChangeText={setPhone}
      />
      {sent ? (
        <Input
          label={t('auth_code_label')}
          keyboardType="number-pad"
          autoComplete="sms-otp"
          placeholder={t('auth_code_ph')}
          value={code}
          onChangeText={setCode}
          hint={devCode ? t('auth_dev_code', { code: devCode }) : undefined}
        />
      ) : null}
      {!sent ? (
        <Button block onPress={send} disabled={busy || !phone}>
          {t('auth_send_code')}
        </Button>
      ) : (
        <>
          <Button block onPress={verify} disabled={busy || code.length < 6}>
            {t('auth_verify')}
          </Button>
          <Button variant="ghost" block onPress={send} disabled={busy}>
            <Text style={styles.ghostBtnText}>{t('auth_resend')}</Text>
          </Button>
        </>
      )}
    </View>
  )
}

/* ── email (international) ──────────────────────────────────────────────────── */
function EmailForm({
  busy,
  setBusy,
  setError,
  onDone,
}: {
  busy: boolean
  setBusy: (b: boolean) => void
  setError: (e: string | null) => void
  onDone: () => Promise<void>
}) {
  const { t } = useI18n()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [view, setView] = useState<'auth' | 'reset'>('auth')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [promo, setPromo] = useState('')

  if (view === 'reset') {
    return (
      <ForgotPasswordForm
        busy={busy}
        setBusy={setBusy}
        setError={setError}
        initialEmail={email}
        onBack={() => {
          setView('auth')
          setError(null)
        }}
      />
    )
  }

  const submit = async () => {
    setError(null)
    setBusy(true)
    try {
      if (mode === 'register') {
        const res = await registerEmail({ email, password, displayName: name, promoCode: promo.trim() || undefined })
        // Sign-up succeeded; if the promo code couldn't be applied, tell the
        // user (they keep the new free account and can redeem later) rather
        // than silently landing them on free.
        notifyPromo(res, t)
      } else {
        await loginEmail({ email, password })
      }
      await onDone()
    } catch (e) {
      setError(t(errKey((e as Error).message)))
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={styles.formGap}>
      {mode === 'register' ? (
        <Input
          label={t('auth_name_label')}
          autoComplete="name"
          placeholder={t('auth_name_ph')}
          value={name}
          onChangeText={setName}
        />
      ) : null}
      <Input
        label={t('auth_email_label')}
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="email"
        placeholder={t('auth_email_ph')}
        value={email}
        onChangeText={setEmail}
      />
      <Input
        label={t('auth_password_label')}
        secureTextEntry
        autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
        placeholder={t('auth_password_ph')}
        value={password}
        onChangeText={setPassword}
      />
      {mode === 'register' ? (
        <Input
          label={t('auth_promo_label')}
          autoCapitalize="characters"
          autoComplete="off"
          placeholder={t('auth_promo_ph')}
          value={promo}
          onChangeText={setPromo}
        />
      ) : null}
      <Button block onPress={submit} disabled={busy || !email || !password}>
        {mode === 'login' ? t('auth_login') : t('auth_register')}
      </Button>
      <Button
        variant="ghost"
        block
        onPress={() => {
          setMode(mode === 'login' ? 'register' : 'login')
          setError(null)
        }}
      >
        <Text style={styles.ghostBtnText}>
          {mode === 'login' ? t('auth_to_register') : t('auth_to_login')}
        </Text>
      </Button>
      {mode === 'login' ? (
        <Button
          variant="ghost"
          block
          onPress={() => {
            setView('reset')
            setError(null)
          }}
        >
          <Text style={styles.ghostBtnText}>{t('auth_forgot_password')}</Text>
        </Button>
      ) : null}
    </View>
  )
}

/* ── forgot password (email) ────────────────────────────────────────────────
   Two steps in one card:
     1) enter email → reset-request (always shows the same enumeration-safe
        "若该邮箱已注册，已发送重置邮件" notice, regardless of result).
     2) enter the emailed token + a new password → reset-verify → on success
        route back to sign in.
   submitReset is split out (like notifyPromo) so the network+decision logic is
   unit-testable without mounting the whole screen. */

/** Step 2 submit: verifies the token + new password, then signals success. The
 *  payload it sends is exactly { email, token, newPassword } — pinned by tests
 *  so a regression in the wired-up fields is caught. */
export async function submitReset(
  args: { email: string; token: string; newPassword: string },
  onSuccess: () => void,
): Promise<void> {
  await verifyPasswordReset({
    email: args.email,
    token: args.token,
    newPassword: args.newPassword,
  })
  onSuccess()
}

function ForgotPasswordForm({
  busy,
  setBusy,
  setError,
  initialEmail,
  onBack,
}: {
  busy: boolean
  setBusy: (b: boolean) => void
  setError: (e: string | null) => void
  initialEmail: string
  onBack: () => void
}) {
  const { t } = useI18n()
  const [step, setStep] = useState<'email' | 'token'>('email')
  const [email, setEmail] = useState(initialEmail)
  const [token, setToken] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const sendEmail = async () => {
    setError(null)
    setBusy(true)
    try {
      await requestPasswordReset(email)
    } catch (e) {
      // Stay enumeration-safe in the UI too: surface the generic notice even on
      // a (rare) error, and advance so the user can paste a token.
      void e
    } finally {
      setBusy(false)
      setNotice(t('auth_reset_sent'))
      setStep('token')
    }
  }

  const submit = async () => {
    setError(null)
    setBusy(true)
    try {
      await submitReset({ email, token, newPassword }, () => setDone(true))
    } catch (e) {
      setError(t(errKey((e as Error).message)))
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <View style={styles.formGap}>
        <Text style={styles.resetTitle}>{t('auth_reset_done')}</Text>
        <Button block onPress={onBack}>
          {t('auth_reset_back')}
        </Button>
      </View>
    )
  }

  return (
    <View style={styles.formGap}>
      <Text style={styles.resetTitle}>{t('auth_reset_title')}</Text>
      <Input
        label={t('auth_email_label')}
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="email"
        placeholder={t('auth_email_ph')}
        hint={step === 'email' ? t('auth_reset_email_hint') : undefined}
        value={email}
        onChangeText={setEmail}
      />
      {step === 'email' ? (
        <Button block onPress={sendEmail} disabled={busy || !email}>
          {t('auth_reset_send')}
        </Button>
      ) : (
        <>
          {notice ? (
            <View style={styles.noticeBox}>
              <Text style={styles.noticeText}>{notice}</Text>
            </View>
          ) : null}
          <Input
            label={t('auth_reset_token_label')}
            autoCapitalize="none"
            autoComplete="off"
            placeholder={t('auth_reset_token_ph')}
            value={token}
            onChangeText={setToken}
          />
          <Input
            label={t('auth_reset_new_password_label')}
            secureTextEntry
            autoComplete="new-password"
            placeholder={t('auth_reset_new_password_ph')}
            value={newPassword}
            onChangeText={setNewPassword}
          />
          <Button
            block
            onPress={submit}
            disabled={busy || !token || newPassword.length < 8}
          >
            {t('auth_reset_submit')}
          </Button>
        </>
      )}
      <Button variant="ghost" block onPress={onBack}>
        <Text style={styles.ghostBtnText}>{t('auth_reset_back')}</Text>
      </Button>
    </View>
  )
}

/* ── social buttons ────────────────────────────────────────────────────────── */
function SocialButtons({
  providers,
  method,
  t,
  setError,
  onDone,
}: {
  providers: ProviderStatus[]
  method: Method
  t: (k: string, v?: Record<string, string | number>) => string
  setError: (e: string | null) => void
  onDone: () => Promise<void>
}) {
  // Shared in-flight guard: prevents any two concurrent openAuthSessionAsync
  // sessions (same or different providers) from racing each other.
  // Must be declared before any early return to satisfy Rules of Hooks.
  const oauthInFlight = useRef(false)

  // Surface the providers that match the current habit.
  const audience = method === 'phone' ? 'domestic' : 'international'
  const shown = providers.filter((p) => p.audience === audience)
  if (shown.length === 0) return null

  return (
    <View style={styles.socialSection}>
      <View style={styles.orDivider}>
        <View style={styles.dividerLine} />
        <Text style={styles.orText}>{t('auth_or')}</Text>
        <View style={styles.dividerLine} />
      </View>

      <View style={styles.socialButtons}>
        {shown.map((p) => {
          const label = t('auth_continue_with', { p: p.label })
          if (!p.configured) {
            return (
              <Button
                key={p.id}
                variant="secondary"
                block
                style={{ opacity: 0.6 }}
                onPress={() =>
                  setError(t('auth_err_provider_unavailable', { p: p.label }))
                }
                iconLeft={<Icon name="lock" size={16} color="#9b8fa3" />}
              >
                {label}
              </Button>
            )
          }
          return (
            <Button
              key={p.id}
              variant="secondary"
              block
              onPress={() => {
                if (oauthInFlight.current) return
                oauthInFlight.current = true
                void handleOAuth(
                  oauthStartUrl(p.id),
                  async (token) => {
                    // Store the token in the shared api-client memory so that
                    // refresh() picks it up via getAuthToken() and persists it.
                    setAuthToken(token)
                    await onDone()
                  },
                  (reason) => setError(t(errKey(reason))),
                ).finally(() => {
                  oauthInFlight.current = false
                })
              }}
              iconLeft={<Icon name="user" size={16} color="#3a2f43" />}
            >
              {label}
            </Button>
          )
        })}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  inner: {
    width: '100%',
    maxWidth: 380,
  },
  // lang switcher row
  langRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginBottom: 14,
  },
  // brand block
  brand: {
    alignItems: 'center',
    marginBottom: 8,
  },
  brandTitle: {
    fontWeight: '700',
    fontSize: 26,
    color: colors.ink900,
    marginTop: 8,
  },
  brandOr: {
    color: colors.candyPink,
  },
  brandTagline: {
    color: colors.ink500,
    fontSize: 14,
    marginTop: 6,
  },
  // auth card
  card: {
    backgroundColor: colors.white,
    borderWidth: 3,
    borderColor: colors.ink900,
    borderRadius: radius.lg,
    padding: 20,
    marginTop: 18,
    shadowColor: colors.ink900,
    shadowOffset: { width: 5, height: 5 },
    shadowOpacity: 1,
    shadowRadius: 0,
  },
  // method toggle
  methodToggle: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 18,
    backgroundColor: colors.paper,
    borderWidth: 3,
    borderColor: colors.ink900,
    borderRadius: radius.md,
    padding: 4,
  },
  methodTab: {
    paddingVertical: 9,
    borderRadius: radius.sm,
    alignItems: 'center',
    overflow: 'hidden',
  },
  methodTabActive: {
    backgroundColor: colors.candyYellow,
  },
  methodTabInactive: {
    backgroundColor: 'transparent',
  },
  methodTabLabel: {
    fontWeight: '700',
    fontSize: 14,
    color: colors.ink900,
  },
  // error banner
  errorBox: {
    marginTop: 14,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: radius.md,
    backgroundColor: colors.verdictNah,
    borderWidth: 3,
    borderColor: colors.ink900,
  },
  errorText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  // form
  formGap: {
    gap: 12,
  },
  resetTitle: {
    fontWeight: '700',
    fontSize: 16,
    color: colors.ink900,
  },
  noticeBox: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: radius.md,
    backgroundColor: colors.paper,
    borderWidth: 3,
    borderColor: colors.ink900,
  },
  noticeText: {
    color: colors.ink900,
    fontSize: 13,
    fontWeight: '600',
  },
  ghostBtnText: {
    color: colors.candyPink,
    fontSize: 13,
    fontWeight: '600',
  },
  // social section
  socialSection: {
    marginTop: 18,
  },
  orDivider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginVertical: 4,
    marginBottom: 14,
  },
  dividerLine: {
    flex: 1,
    height: 2,
    backgroundColor: colors.ink200,
  },
  orText: {
    color: colors.ink400,
    fontSize: 12,
    letterSpacing: 0.96,
    textTransform: 'uppercase',
  },
  socialButtons: {
    gap: 10,
  },
})
