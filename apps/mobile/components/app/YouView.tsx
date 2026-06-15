/* ============================================================
   YUMMY OR NOT — YouView (plain RN + theme, no Tamagui)
   RN port of the web YouView: profile header (avatar + name), verdict
   stat tiles, money-saved card, a language switcher wired to the i18n
   provider, and a settings list.

   "Money saved" is computed locally from the passed-in items (sum of
   "nah" prices) — mirrors the web original, which framed it the same
   way without hitting the stats endpoint.
   ============================================================ */

import { useCallback, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native'
import { KeyboardStickyView } from 'react-native-keyboard-controller'
import { useRouter } from 'expo-router'
import * as ImagePicker from 'expo-image-picker'
import {
  LANGS,
  updateUser,
  requestAvatarPresign,
  uploadToPresignedUrl,
  type Taste,
} from '@yon/shared'

import { Avatar, Button, Card, Icon, Input, LangSwitcher, Switch } from '@/components/ds'
import { colors, space, radius, Text } from '@/theme'
import { compressAsset } from '@/lib/compressAsset'
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
  testID,
}: {
  icon: string
  label: string
  last?: boolean
  onPress?: () => void
  testID?: string
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      testID={testID}
    >
      <View
        style={[
          styles.settingRow,
          last ? styles.settingRowLast : styles.settingRowBorder,
        ]}
      >
        <Icon name={icon} size={20} color="#5a4f63" />
        <Text style={styles.settingRowLabel}>{label}</Text>
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
  // S3c: new-record default visibility. The Switch is boolean — ON = 'shared'.
  const [defaultShared, setDefaultShared] = useState(() => user?.defaultVisibility === 'shared')

  // Nickname edit modal state
  const [editNameOpen, setEditNameOpen] = useState(false)
  const [nameInput, setNameInput] = useState('')
  const [nameSaving, setNameSaving] = useState(false)
  const [nameError, setNameError] = useState('')

  // S3b-media: avatar upload state. `avatarUploading` drives the spinner over the
  // header; `avatarError` is a non-blocking message (the old avatar stays put on
  // failure). A ref guards against a double-tap re-entering the picker.
  const [avatarUploading, setAvatarUploading] = useState(false)
  const [avatarError, setAvatarError] = useState('')
  const avatarPickInFlight = useRef(false)

  // Pick → compress → presign → PUT-to-R2 → commit (PATCH /api/user) → refresh
  // the in-memory user so the header re-renders the new presigned avatar URL.
  // Picker cancel is a no-op; any failure keeps the old avatar and surfaces a
  // non-blocking inline message (never crashes).
  async function changeAvatar() {
    if (avatarPickInFlight.current) return
    avatarPickInFlight.current = true
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync()
      if (!perm.granted) {
        setAvatarError(t('photo_permission_denied'))
        return
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 1,
      })
      if (result.canceled || !result.assets[0]) return
      setAvatarError('')
      setAvatarUploading(true)
      const compressed = await compressAsset(result.assets[0])
      // Phase 1 is native-only, so compressAsset always yields an RNFile (the
      // {uri,name,type} shape). The PhotoInput union also admits a web File,
      // hence the guard before reading uri.
      const fileUri = 'uri' in compressed ? compressed.uri : ''
      const { uploadUrl, key, headers } = await requestAvatarPresign({
        kind: 'avatar',
        contentType: 'image/jpeg',
      })
      await uploadToPresignedUrl(uploadUrl, headers, fileUri)
      const { user: updated } = await updateUser({ avatar: key })
      patchUser({ avatar: updated.avatar })
    } catch {
      setAvatarError(t('avatar_upload_failed'))
    } finally {
      setAvatarUploading(false)
      avatarPickInFlight.current = false
    }
  }

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

  const toggleDefaultVisibility = async (next: boolean) => {
    const prev = defaultShared
    setDefaultShared(next)
    const value = next ? 'shared' : 'private'
    try {
      const { user: updated } = await updateUser({ defaultVisibility: value })
      patchUser({ defaultVisibility: updated.defaultVisibility })
    } catch {
      setDefaultShared(prev)
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
    color: string,
    verdict: 'yum' | 'meh' | 'nah',
  ) => (
    <Pressable
      accessibilityRole="button"
      onPress={() => openVerdict(verdict)}
      style={{ flex: 1 }}
    >
      <View style={[styles.statTile, { backgroundColor: color }]}>
        <Text style={styles.statValue}>{value}</Text>
        <Text style={styles.statLabel}>{label}</Text>
      </View>
    </Pressable>
  )

  // Verdict-breakdown bar — ported from the removed Stats tab.
  const bar = (
    label: string,
    verdict: 'yum' | 'meh' | 'nah',
    color: string,
  ) => {
    const n = count(verdict)
    const pct = total > 0 ? (n / total) * 100 : 0
    return (
      <View style={styles.barRow}>
        <View style={styles.barHeader}>
          <Text style={styles.barLabel}>{label}</Text>
          <Text style={styles.barLabel}>{n}</Text>
        </View>
        <View style={styles.barTrack}>
          <View style={[styles.barFill, { width: `${pct}%` as `${number}%`, backgroundColor: color }]} />
        </View>
      </View>
    )
  }

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.container}>
      {/* avatar header */}
      <View style={styles.header}>
        <Pressable
          onPress={changeAvatar}
          disabled={avatarUploading}
          accessibilityRole="button"
          accessibilityLabel={t('change_photo')}
          testID="avatar-change-btn"
        >
          <Avatar name={displayName} src={user?.avatar || undefined} size="lg" />
          {avatarUploading ? (
            <View style={styles.avatarSpinner} testID="avatar-uploading">
              <ActivityIndicator color={colors.white} />
            </View>
          ) : null}
        </Pressable>
        <View style={styles.headerInfo}>
          <View style={styles.nameRow}>
            <Text style={styles.displayName} testID="display-name">
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
              <View style={styles.proBadge}>
                <Text style={styles.proBadgeText}>{t('pro_plan')}</Text>
              </View>
            ) : null}
          </View>
          {/* tastes_logged taps to Library tab */}
          <Pressable
            onPress={() => router.push('/(tabs)')}
            accessibilityRole="button"
            testID="tastes-logged-btn"
          >
            <Text style={styles.tastesLogged}>{t('tastes_logged', { n: tastedItems.length })}</Text>
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

      {/* non-blocking avatar upload error — old avatar stays on failure */}
      {avatarError ? (
        <Text style={styles.avatarError} testID="avatar-error">
          {avatarError}
        </Text>
      ) : null}

      {/* verdict stat tiles */}
      <View style={styles.statRow}>
        {stat(t('yum'), count('yum'), colors.verdictYum, 'yum')}
        {stat(t('meh'), count('meh'), colors.verdictMeh, 'meh')}
        {stat(t('nah'), count('nah'), colors.verdictNah, 'nah')}
      </View>

      {/* saved card — informational (formerly tapped to the removed Stats tab) */}
      <Card
        padded
        style={{ marginTop: space[4] }}
        testID="savings-card"
      >
        <View style={styles.savingsRow}>
          <Icon name="coin" size={36} color="#ff5ca8" />
          <View>
            <Text style={styles.savingsAmt}>{t('saved_amt', { amt: savedAmount })}</Text>
            <Text style={styles.savingsSub}>{t('saved_sub')}</Text>
          </View>
        </View>
      </Card>

      {/* verdict breakdown — ported from the removed Stats tab so 我的 retains
          all former stats content. */}
      <Card padded style={{ marginTop: space[4] }} testID="verdict-breakdown-card">
        <Text style={styles.sectionKicker}>{t('verdict_breakdown')}</Text>
        <View style={{ marginTop: 18 }}>
          {bar(t('yum_buy_again'), 'yum', colors.verdictYum)}
          {bar(t('meh_maybe'), 'meh', colors.verdictMeh)}
          {bar(t('nah_skip'), 'nah', colors.verdictNah)}
        </View>
      </Card>

      {/* settings list */}
      <View style={{ marginTop: 18 }}>
        <Text style={styles.settingsKicker}>{t('settings')}</Text>
        <View style={styles.settingRow}>
          <Icon name="alert" size={20} color="#5a4f63" />
          <Text style={styles.settingRowLabel}>{t('set_warnings')}</Text>
          <Switch checked={warningsEnabled} onChange={toggleWarnings} testID="warnings-switch" />
        </View>
        <View style={styles.settingRow}>
          <Icon name="map" size={20} color="#5a4f63" />
          <Text style={styles.settingRowLabel}>{t('set_location')}</Text>
          <Switch checked={locationEnabled} onChange={toggleLocation} testID="location-switch" />
        </View>
        {/* S3c: new-record default visibility — ON = 'shared' (公开到附近). */}
        <View style={styles.settingRow}>
          <Icon name="eye" size={20} color="#5a4f63" />
          <Text style={styles.settingRowLabel}>{t('set_default_visibility')}</Text>
          <Switch
            checked={defaultShared}
            onChange={toggleDefaultVisibility}
            testID="default-visibility-switch"
          />
        </View>
        {/* "附近 · 热力" is now a bottom tab (附近) — no duplicate entry here. */}
        {/* Tag management — navigates to /tags stack screen */}
        <SettingRow
          icon="tag"
          label={t('tag_manage')}
          onPress={() => router.push('/tags')}
        />
        {/* S3b — "家人": single merged entry (口味家人 + 家人的口味). The /family
            screen lists family members (personas) with add/edit/delete, and
            tapping a member enters their 口味. Pro-gated: free accounts cannot
            own multiple personas, so the entry self-hides (consistent with
            TasterSwitcher hiding for free accounts). */}
        {user?.plan === 'pro' ? (
          <SettingRow
            icon="users"
            label={t('family_entry')}
            onPress={() => router.push('/family')}
            testID="family-entry-row"
          />
        ) : null}
        {/* S3a — "enter import code" fallback (WeChat strips the deep link). */}
        <SettingRow
          icon="download"
          label={t('import_code_entry')}
          onPress={() => router.push('/import-code')}
          last
        />
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
        <Pressable style={modalStyles.sheetOverlay} onPress={closeEditName}>
          {/* KeyboardStickyView rides the sheet up with the keyboard so the
              nickname input and the save/cancel row stay above it instead of
              being hidden behind it (matches AddModal / TagManageView). */}
          <KeyboardStickyView>
            <Pressable style={modalStyles.sheetContent} onPress={() => {}}>
              <Text style={modalStyles.modalTitle}>{t('edit_profile')}</Text>
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
                <Text style={modalStyles.errorText} testID="name-error">
                  {nameError}
                </Text>
              ) : null}
              <View style={modalStyles.buttonRow}>
                <Button variant="ghost" onPress={closeEditName}>
                  {t('cancel')}
                </Button>
                <Button
                  variant="primary"
                  disabled={nameSaving || !nameInput.trim()}
                  onPress={submitEditName}
                  testID="save-name-btn"
                >
                  {t('save')}
                </Button>
              </View>
            </Pressable>
          </KeyboardStickyView>
        </Pressable>
      </Modal>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    backgroundColor: colors.background,
  },
  container: {
    padding: 20,
  },
  // header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginTop: space[1],
  },
  headerInfo: {
    flex: 1,
  },
  // Spinner overlay covering the avatar while an upload is in flight.
  avatarSpinner: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: radius.md,
  },
  avatarError: {
    color: colors.verdictNah2,
    fontSize: 13,
    marginTop: space[2],
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  displayName: {
    color: colors.ink900,
    fontWeight: '700',
    fontSize: 22,
  },
  proBadge: {
    backgroundColor: colors.candyYellow,
    borderWidth: 2,
    borderColor: colors.ink900,
    borderRadius: radius.sm,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  proBadgeText: {
    color: colors.ink900,
    fontWeight: '700',
    fontSize: 10,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  tastesLogged: {
    color: colors.ink500,
  },
  // stat tiles
  statRow: {
    flexDirection: 'row',
    gap: space[3],
    marginTop: 18,
  },
  statTile: {
    paddingVertical: 14,
    paddingHorizontal: 10,
    alignItems: 'center',
    borderWidth: 3,
    borderColor: colors.ink900,
    borderRadius: radius.lg,
    shadowColor: colors.ink900,
    shadowOffset: { width: 5, height: 5 },
    shadowOpacity: 1,
    shadowRadius: 0,
  },
  statValue: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 34,
    lineHeight: 34,
  },
  statLabel: {
    color: '#fff',
    fontSize: 9,
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    marginTop: 6,
  },
  // savings card
  savingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  savingsAmt: {
    color: colors.ink900,
    fontWeight: '700',
    fontSize: 24,
  },
  savingsSub: {
    color: colors.ink500,
    fontSize: 14,
  },
  // section headers
  sectionKicker: {
    color: colors.ink400,
    fontSize: 11,
    letterSpacing: 1.32,
    textTransform: 'uppercase',
  },
  settingsKicker: {
    color: colors.ink400,
    fontSize: 10,
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  // verdict breakdown bars
  barRow: {
    marginBottom: space[4],
  },
  barHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: space[2],
  },
  barLabel: {
    color: colors.ink900,
    fontWeight: '600',
  },
  barTrack: {
    height: 22,
    backgroundColor: colors.white,
    borderWidth: 3,
    borderColor: colors.ink900,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
  },
  // settings rows
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingVertical: 14,
    paddingHorizontal: 2,
    borderBottomWidth: 2,
    borderBottomColor: colors.ink200,
    borderStyle: 'dotted',
  },
  settingRowBorder: {
    borderBottomWidth: 2,
    borderBottomColor: colors.ink200,
    borderStyle: 'dotted',
  },
  settingRowLast: {
    borderBottomWidth: 0,
  },
  settingRowLabel: {
    flex: 1,
    color: colors.ink900,
    fontWeight: '500',
  },
})

const modalStyles = StyleSheet.create({
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
  modalTitle: {
    color: colors.ink900,
    fontWeight: '700',
    fontSize: 18,
    marginBottom: 16,
  },
  errorText: {
    color: colors.verdictNah2,
    fontSize: 13,
    marginTop: 8,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: space[3],
    marginTop: 20,
  },
})
