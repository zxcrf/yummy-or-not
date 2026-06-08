/* ============================================================
   YUMMY OR NOT — AuthScreen (Tamagui / React Native + RN Web)
   RN port of the web signed-out gate. Two onboarding habits side by
   side:
     • Phone + SMS code  (domestic / China default)
     • Email + password  (international)
   Plus social logins (WeChat / Google / Apple) when configured server-
   side. On success it calls useAuth().refresh() and the gate swaps in
   the app.
   ============================================================ */

import { useState } from 'react'
import { KeyboardAvoidingView, Platform } from 'react-native'
import * as WebBrowser from 'expo-web-browser'
import { ScrollView, Text, View } from 'tamagui'
import {
  LANGS,
  loginEmail,
  oauthStartUrl,
  registerEmail,
  requestOtp,
  verifyOtp,
  type ProviderStatus,
} from '@yon/shared'

import { Button, Icon, Input, LangSwitcher } from '@/components/ds'
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
  }
  return map[code] ?? 'auth_err_generic'
}

/** Open an OAuth start URL: in-app browser on native, navigation on web. */
function openOAuth(url: string): void {
  if (Platform.OS === 'web') {
    globalThis.location?.assign(url)
  } else {
    void WebBrowser.openBrowserAsync(url)
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
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        flex={1}
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: 'center',
          alignItems: 'center',
          padding: 20,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <View width="100%" maxWidth={380}>
          {/* lang switcher */}
          <View flexDirection="row" justifyContent="flex-end" marginBottom={14}>
            <LangSwitcher
              value={lang}
              onChange={setLang}
              languages={LANGS}
              align="right"
              tone="$candyPink"
            />
          </View>

          {/* brand */}
          <View alignItems="center" marginBottom={8}>
            <Icon name="heart" size={48} color="#ff2e88" />
            <Text fontWeight="700" fontSize={26} color="$ink900" marginTop={8}>
              yummy <Text color="$candyPink">or</Text> not
            </Text>
            <Text color="$ink500" fontSize={14} marginTop={6}>
              {t('auth_tagline')}
            </Text>
          </View>

          {/* card */}
          <View
            backgroundColor="$white"
            borderWidth={3}
            borderColor="$ink900"
            borderRadius="$lg"
            padding={20}
            marginTop={18}
            shadowColor="$ink900"
            shadowOffset={{ width: 5, height: 5 }}
            shadowOpacity={1}
            shadowRadius={0}
          >
            {/* method toggle */}
            <View
              flexDirection="row"
              gap={6}
              marginBottom={18}
              backgroundColor="$paper"
              borderWidth={3}
              borderColor="$ink900"
              borderRadius="$md"
              padding={4}
            >
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
              <View
                marginTop={14}
                paddingVertical={10}
                paddingHorizontal={12}
                borderRadius="$md"
                backgroundColor="$verdictNah"
                borderWidth={3}
                borderColor="$ink900"
              >
                <Text color="#fff" fontSize={13} fontWeight="600">
                  {error}
                </Text>
              </View>
            ) : null}

            {/* social logins */}
            <SocialButtons
              providers={providers}
              method={method}
              t={t}
              setError={setError}
            />
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

/* ── tab ─────────────────────────────────────────────────────────────────── */
function MethodTab({
  active,
  onPress,
  label,
}: {
  active: boolean
  onPress: () => void
  label: string
}) {
  return (
    <View
      flex={1}
      paddingVertical={9}
      borderRadius="$sm"
      alignItems="center"
      backgroundColor={active ? '$candyYellow' : 'transparent'}
      cursor="pointer"
      accessibilityRole="button"
      onPress={onPress}
    >
      <Text fontWeight="700" fontSize={14} color="$ink900">
        {label}
      </Text>
    </View>
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
    <View gap={12}>
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
            <Text color="$candyPink" fontSize={13} fontWeight="600">
              {t('auth_resend')}
            </Text>
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
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [promo, setPromo] = useState('')

  const submit = async () => {
    setError(null)
    setBusy(true)
    try {
      if (mode === 'register') {
        await registerEmail({ email, password, displayName: name, promoCode: promo.trim() || undefined })
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
    <View gap={12}>
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
        <Text color="$candyPink" fontSize={13} fontWeight="600">
          {mode === 'login' ? t('auth_to_register') : t('auth_to_login')}
        </Text>
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
}: {
  providers: ProviderStatus[]
  method: Method
  t: (k: string, v?: Record<string, string | number>) => string
  setError: (e: string | null) => void
}) {
  // Surface the providers that match the current habit.
  const audience = method === 'phone' ? 'domestic' : 'international'
  const shown = providers.filter((p) => p.audience === audience)
  if (shown.length === 0) return null

  return (
    <View marginTop={18}>
      <View
        flexDirection="row"
        alignItems="center"
        gap={10}
        marginVertical={4}
        marginBottom={14}
      >
        <View flex={1} height={2} backgroundColor="$ink200" />
        <Text
          color="$ink400"
          fontSize={12}
          letterSpacing={0.96}
          textTransform="uppercase"
        >
          {t('auth_or')}
        </Text>
        <View flex={1} height={2} backgroundColor="$ink200" />
      </View>

      <View gap={10}>
        {shown.map((p) => {
          const label = t('auth_continue_with', { p: p.label })
          if (!p.configured) {
            return (
              <Button
                key={p.id}
                variant="secondary"
                block
                opacity={0.6}
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
              onPress={() => openOAuth(oauthStartUrl(p.id))}
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
