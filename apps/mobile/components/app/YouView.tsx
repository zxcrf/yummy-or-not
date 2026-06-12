/* ============================================================
   YUMMY OR NOT — YouView (Tamagui / React Native + RN Web)
   RN port of the web YouView: profile header (avatar + name), verdict
   stat tiles, money-saved card, a language switcher wired to the i18n
   provider, and a settings list.

   "Money saved" is computed locally from the passed-in items (sum of
   "nah" prices) — mirrors the web original, which framed it the same
   way without hitting the stats endpoint.
   ============================================================ */

import { useCallback, useState } from 'react'
import { Modal, Pressable, StyleSheet } from 'react-native'
import { useRouter } from 'expo-router'
import { type GetProps, ScrollView, Text, View } from 'tamagui'
import { LANGS, updateUser, type Taste } from '@yon/shared'

import { Avatar, Button, Card, Icon, Input, LangSwitcher, Switch } from '@/components/ds'
import { space } from '@/theme'
import { useAuth } from '@/providers/AuthProvider'
import { useI18n } from '@/providers/I18nProvider'

interface Props {
  items: Taste[]
}

function SettingRow({
  icon,
  label,
  last,
  onPress,
}: {
  icon: string
  label: string
  last?: boolean
  onPress?: () => void
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
    >
      <View
        flexDirection="row"
        alignItems="center"
        gap="$3"
        paddingVertical={14}
        paddingHorizontal={2}
        borderBottomWidth={last ? 0 : 2}
        borderBottomColor="$ink200"
        borderStyle="dotted"
      >
        <Icon name={icon} size={20} color="#5a4f63" />
        <Text flex={1} color="$ink900" fontWeight="500">
          {label}
        </Text>
        <Icon name="chevron-right" size={18} color="#cfc7d4" />
      </View>
    </Pressable>
  )
}

/** Derive a display name from the user object, never falling back to a hardcoded name. */
function deriveDisplayName(
  user: { displayName?: string; email?: string; phone?: string } | null | undefined,
  defaultName: string,
): string {
  if (user?.displayName && user.displayName.trim()) return user.displayName.trim()
  const emailLocal = user?.email?.split('@')[0]?.trim()
  if (emailLocal) return emailLocal
  if (user?.phone && user.phone.length >= 4) return `Foodie ${user.phone.slice(-4)}`
  return defaultName
}

export default function YouView({ items }: Props) {
  const { t, lang, setLang, formatMoney } = useI18n()
  const { user, signOut, patchUser } = useAuth()
  const router = useRouter()

  const [warningsEnabled, setWarningsEnabled] = useState(() => user?.warningsEnabled ?? false)
  const [locationEnabled, setLocationEnabled] = useState(() => user?.locationEnabled ?? false)

  // Nickname edit modal state
  const [editNameOpen, setEditNameOpen] = useState(false)
  const [nameInput, setNameInput] = useState('')
  const [nameSaving, setNameSaving] = useState(false)
  const [nameError, setNameError] = useState('')

  const toggleWarnings = async (next: boolean) => {
    const prev = warningsEnabled
    setWarningsEnabled(next)
    try {
      const { user: updated } = await updateUser({ warningsEnabled: next })
      patchUser({ warningsEnabled: updated.warningsEnabled })
    } catch {
      setWarningsEnabled(prev)
    }
  }

  const toggleLocation = async (next: boolean) => {
    const prev = locationEnabled
    setLocationEnabled(next)
    try {
      const { user: updated } = await updateUser({ locationEnabled: next })
      patchUser({ locationEnabled: updated.locationEnabled })
    } catch {
      setLocationEnabled(prev)
    }
  }

  function openEditName() {
    setNameInput(user?.displayName ?? '')
    setNameError('')
    setEditNameOpen(true)
  }

  function closeEditName() {
    setEditNameOpen(false)
    setNameError('')
  }

  async function submitEditName() {
    const trimmed = nameInput.trim()
    if (!trimmed || trimmed.length > 50) {
      setNameError(t('invalid_display_name'))
      return
    }
    setNameSaving(true)
    setNameError('')
    try {
      const { user: updated } = await updateUser({ displayName: trimmed })
      patchUser({ displayName: updated.displayName })
      closeEditName()
    } catch {
      setNameError(t('invalid_display_name'))
    } finally {
      setNameSaving(false)
    }
  }

  const displayName = deriveDisplayName(user, t('default_name'))

  // Stats only count tasted items — todos have no verdict
  const tastedItems = items.filter((it) => (it.status ?? 'tasted') === 'tasted')

  const count = (v: 'yum' | 'meh' | 'nah') =>
    tastedItems.filter((it) => it.verdict === v).length

  // Total tasted records — denominator for the verdict-breakdown bars.
  const total = tastedItems.length

  const saved = tastedItems
    .filter((it) => it.verdict === 'nah')
    .reduce((sum, it) => {
      const n = parseFloat((it.price ?? '').replace(/[^0-9.]/g, ''))
      return sum + (Number.isFinite(n) ? n : 0)
    }, 0)
  const savedAmount = formatMoney(saved)

  const openVerdict = useCallback(
    (verdict: 'yum' | 'meh' | 'nah') => {
      router.push({ pathname: '/(tabs)', params: { verdict } })
    },
    [router],
  )

  const stat = (
    label: string,
    value: number,
    color: GetProps<typeof View>['backgroundColor'],
    verdict: 'yum' | 'meh' | 'nah',
  ) => (
    <Pressable
      accessibilityRole="button"
      onPress={() => openVerdict(verdict)}
      style={{ flex: 1, cursor: 'pointer' }}
    >
      <View
        paddingVertical={14}
        paddingHorizontal={10}
        alignItems="center"
        borderWidth={3}
        borderColor="$ink900"
        borderRadius="$lg"
        backgroundColor={color}
        shadowColor="$ink900"
        shadowOffset={{ width: 5, height: 5 }}
        shadowOpacity={1}
        shadowRadius={0}
      >
        <Text color="#fff" fontWeight="700" fontSize={34} lineHeight={34}>
          {value}
        </Text>
        <Text
          color="#fff"
          fontSize={9}
          letterSpacing={1.1}
          textTransform="uppercase"
          marginTop={6}
        >
          {label}
        </Text>
      </View>
    </Pressable>
  )

  // Verdict-breakdown bar — ported from the removed Stats tab.
  const bar = (
    label: string,
    verdict: 'yum' | 'meh' | 'nah',
    color: GetProps<typeof View>['backgroundColor'],
  ) => {
    const n = count(verdict)
    const pct = total > 0 ? (n / total) * 100 : 0
    return (
      <View marginBottom="$4">
        <View flexDirection="row" justifyContent="space-between" marginBottom="$2">
          <Text color="$ink900" fontWeight="600">
            {label}
          </Text>
          <Text color="$ink900" fontWeight="600">
            {n}
          </Text>
        </View>
        <View
          height={22}
          backgroundColor="$white"
          borderWidth={3}
          borderColor="$ink900"
          borderRadius="$pill"
          overflow="hidden"
        >
          <View width={`${pct}%`} height="100%" backgroundColor={color} />
        </View>
      </View>
    )
  }

  return (
    <ScrollView flex={1} backgroundColor="$background" contentContainerStyle={{ padding: 20 }}>
      {/* avatar header */}
      <View flexDirection="row" alignItems="center" gap={14} marginTop="$1">
        <Avatar name={displayName} src={user?.avatar || undefined} size="lg" />
        <View flex={1}>
          <View flexDirection="row" alignItems="center" gap={8} flexWrap="wrap">
            <Text color="$ink900" fontWeight="700" fontSize={22} testID="display-name">
              {displayName}
            </Text>
            <Pressable
              onPress={openEditName}
              accessibilityRole="button"
              testID="edit-name-btn"
              style={{ padding: 4 }}
            >
              <Icon name="edit" size={16} color="#9b8fa4" />
            </Pressable>
            {user?.plan === 'pro' ? (
              <View
                backgroundColor="$candyYellow"
                borderWidth={2}
                borderColor="$ink900"
                borderRadius="$sm"
                paddingHorizontal={8}
                paddingVertical={2}
              >
                <Text
                  color="$ink900"
                  fontWeight="700"
                  fontSize={10}
                  letterSpacing={0.8}
                  textTransform="uppercase"
                >
                  {t('pro_plan')}
                </Text>
              </View>
            ) : null}
          </View>
          {/* tastes_logged taps to Library tab */}
          <Pressable
            onPress={() => router.push('/(tabs)')}
            accessibilityRole="button"
            testID="tastes-logged-btn"
          >
            <Text color="$ink500">{t('tastes_logged', { n: tastedItems.length })}</Text>
          </Pressable>
        </View>
        <LangSwitcher
          value={lang}
          onChange={setLang}
          languages={LANGS}
          align="right"
          triggerMode="flag"
        />
      </View>

      {/* verdict stat tiles */}
      <View flexDirection="row" gap="$3" marginTop={18}>
        {stat(t('yum'), count('yum'), '$verdictYum', 'yum')}
        {stat(t('meh'), count('meh'), '$verdictMeh', 'meh')}
        {stat(t('nah'), count('nah'), '$verdictNah', 'nah')}
      </View>

      {/* saved card — informational (formerly tapped to the removed Stats tab) */}
      <Card
        padded
        marginTop="$4"
        flexDirection="row"
        alignItems="center"
        gap={14}
        testID="savings-card"
      >
        <Icon name="coin" size={36} color="#ff5ca8" />
        <View>
          <Text color="$ink900" fontWeight="700" fontSize={24}>
            {t('saved_amt', { amt: savedAmount })}
          </Text>
          <Text color="$ink500" fontSize={14}>
            {t('saved_sub')}
          </Text>
        </View>
      </Card>

      {/* verdict breakdown — ported from the removed Stats tab so 我的 retains
          all former stats content. */}
      <Card padded style={{ marginTop: space[4] }} testID="verdict-breakdown-card">
        <Text
          color="$ink400"
          fontSize={11}
          letterSpacing={1.32}
          textTransform="uppercase"
        >
          {t('verdict_breakdown')}
        </Text>
        <View marginTop={18}>
          {bar(t('yum_buy_again'), 'yum', '$verdictYum')}
          {bar(t('meh_maybe'), 'meh', '$verdictMeh')}
          {bar(t('nah_skip'), 'nah', '$verdictNah')}
        </View>
      </Card>

      {/* settings list */}
      <View marginTop={18}>
        <Text
          color="$ink400"
          fontSize={10}
          letterSpacing={1.1}
          textTransform="uppercase"
          marginBottom={10}
        >
          {t('settings')}
        </Text>
        <View
          flexDirection="row"
          alignItems="center"
          gap="$3"
          paddingVertical={14}
          paddingHorizontal={2}
          borderBottomWidth={2}
          borderBottomColor="$ink200"
          borderStyle="dotted"
        >
          <Icon name="alert" size={20} color="#5a4f63" />
          <Text flex={1} color="$ink900" fontWeight="500">
            {t('set_warnings')}
          </Text>
          <Switch checked={warningsEnabled} onChange={toggleWarnings} testID="warnings-switch" />
        </View>
        <View
          flexDirection="row"
          alignItems="center"
          gap="$3"
          paddingVertical={14}
          paddingHorizontal={2}
          borderBottomWidth={2}
          borderBottomColor="$ink200"
          borderStyle="dotted"
        >
          <Icon name="map" size={20} color="#5a4f63" />
          <Text flex={1} color="$ink900" fontWeight="500">
            {t('set_location')}
          </Text>
          <Switch checked={locationEnabled} onChange={toggleLocation} testID="location-switch" />
        </View>
        {/* Tag management — navigates to /tags stack screen */}
        <SettingRow
          icon="tag"
          label={t('tag_manage')}
          onPress={() => router.push('/tags')}
        />
        {/* set_private row removed until S3 */}
      </View>

      {/* sign out */}
      <Button
        variant="secondary"
        block
        style={{ marginTop: 18 }}
        onPress={() => {
          void signOut()
        }}
        iconLeft={<Icon name="arrow-right" size={18} color="#191017" />}
      >
        {t('auth_signout')}
      </Button>

      {/* Nickname edit modal */}
      <Modal
        visible={editNameOpen}
        transparent
        animationType="slide"
        onRequestClose={closeEditName}
      >
        <Pressable style={styles.sheetOverlay} onPress={closeEditName}>
          <Pressable style={styles.sheetContent} onPress={() => {}}>
            <Text color="$ink900" fontWeight="700" fontSize={18} marginBottom={16}>
              {t('edit_profile')}
            </Text>
            <Input
              label={t('display_name_label')}
              value={nameInput}
              onChangeText={(v) => {
                setNameInput(v)
                setNameError('')
              }}
              testID="display-name-input"
            />
            {nameError ? (
              <Text color="$verdictNah2" fontSize={13} marginTop={8} testID="name-error">
                {nameError}
              </Text>
            ) : null}
            <View flexDirection="row" gap="$3" marginTop={20}>
              <Button variant="ghost" onPress={closeEditName}>
                {t('cancel')}
              </Button>
              <Button
                variant="primary"
                disabled={nameSaving || !nameInput.trim()}
                onPress={submitEditName}
                testID="save-name-btn"
              >
                {t('save_taste')}
              </Button>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  sheetOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheetContent: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 24,
    paddingBottom: 40,
  },
})
