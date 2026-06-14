/* ============================================================
   YUMMY OR NOT — TasterManageView (plain RN + theme, no Tamagui)

   Taster persona management (S3b): list personas (self + others),
   create / rename / re-avatar / delete. Mirrors TagManageView's
   bottom-sheet + Alert.alert patterns.

   Gating (§S3b 权限): taster CRUD + multi-taster is pro-only. Free
   accounts see an upgrade affordance instead of the management UI —
   matching TasterSwitcher (which hides for free accounts). The server
   is the source of truth; this is UI affordance only. If the server
   still answers 403 (createTaster throws 'pro_required'), the create
   path surfaces the upgrade prompt instead of crashing.

   The self-taster is clearly marked and undeletable in the UI
   (defense in depth — the server protects it too).

   After every mutation we call invalidateTasters() so the shared
   _useTasters cache refetches — this is the SAME source TasterSwitcher
   subscribes to, so the switcher reflects new / renamed / removed
   personas without a second source of truth.
   ============================================================ */

import { useState } from 'react'
import { Alert, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { KeyboardStickyView } from 'react-native-keyboard-controller'
import {
  createTaster,
  updateTaster,
  deleteTaster,
  type Taster,
} from '@yon/shared'

import { Avatar, Button, Card, Icon, Input } from '@/components/ds'
import { invalidateTasters, useTasters } from '@/app/(tabs)/_useTasters'
import { useAuth } from '@/providers/AuthProvider'
import { useI18n } from '@/providers/I18nProvider'
import { colors, space, radius, Text } from '@/theme'

type SheetMode =
  | { kind: 'create' }
  | { kind: 'edit'; taster: Taster }
  | null

export default function TasterManageView() {
  const { t } = useI18n()
  const { user } = useAuth()
  const { tasters, loading } = useTasters()

  const [sheet, setSheet] = useState<SheetMode>(null)
  const [nameValue, setNameValue] = useState('')
  const [avatarValue, setAvatarValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  // proBlocked surfaces the upgrade prompt when the server answers 403
  // (createTaster throws 'pro_required') — never a crash.
  const [proBlocked, setProBlocked] = useState(false)

  const isPro = user?.plan === 'pro'

  // Free accounts cannot own multiple personas — show the upgrade affordance
  // instead of the management UI (consistent with TasterSwitcher hiding).
  if (!isPro) {
    return (
      <ScrollView style={styles.scroll} contentContainerStyle={styles.container}>
        <Text style={styles.kicker}>{t('taster_manage')}</Text>
        <Card padded style={{ marginTop: space[3] }} testID="taster-pro-gate">
          <Text style={styles.gateText}>{t('taster_pro_required')}</Text>
        </Card>
      </ScrollView>
    )
  }

  function openCreate() {
    setSheet({ kind: 'create' })
    setNameValue('')
    setAvatarValue('')
    setError('')
  }

  function openEdit(taster: Taster) {
    setSheet({ kind: 'edit', taster })
    setNameValue(taster.displayName)
    setAvatarValue(taster.avatar ?? '')
    setError('')
  }

  function closeSheet() {
    setSheet(null)
    setNameValue('')
    setAvatarValue('')
    setError('')
  }

  async function submitSheet() {
    if (!sheet) return
    const trimmed = nameValue.trim()
    if (!trimmed || trimmed.length > 50) {
      setError(t('taster_invalid_name'))
      return
    }
    const avatar = avatarValue.trim()
    setSaving(true)
    setError('')
    try {
      if (sheet.kind === 'create') {
        await createTaster({ displayName: trimmed, avatar: avatar || undefined })
      } else {
        await updateTaster(sheet.taster.id, { displayName: trimmed, avatar })
      }
      invalidateTasters()
      closeSheet()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('pro_required')) {
        // Server rejected the create as non-pro — show the upgrade prompt,
        // never crash.
        closeSheet()
        setProBlocked(true)
      } else {
        setError(msg)
      }
    } finally {
      setSaving(false)
    }
  }

  function confirmDelete(taster: Taster) {
    // Defense in depth — the self-taster is undeletable; never offer it.
    if (taster.isSelf) return
    Alert.alert(t('taster_delete_confirm'), undefined, [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('del'),
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteTaster(taster.id)
            invalidateTasters()
          } catch {
            // silent — list re-renders from cache
          }
        },
      },
    ])
  }

  const sheetTitle = sheet?.kind === 'edit' ? t('edit_profile') : t('taster_create')

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.container}>
      <Text style={styles.kicker}>{t('taster_manage')}</Text>

      {proBlocked ? (
        <Card padded style={{ marginTop: space[3] }} testID="taster-pro-gate">
          <Text style={styles.gateText}>{t('taster_pro_required')}</Text>
        </Card>
      ) : null}

      {!loading && tasters.length === 0 ? (
        <Text style={styles.emptyText}>{t('taster_empty')}</Text>
      ) : null}

      {tasters.map((taster, idx) => (
        <View
          key={taster.id}
          style={[
            styles.row,
            idx === tasters.length - 1 ? styles.rowLast : styles.rowBorder,
          ]}
        >
          <Avatar name={taster.displayName} src={taster.avatar || undefined} size="sm" />
          <View style={styles.rowText}>
            <Text style={styles.rowName}>{taster.displayName}</Text>
            {taster.isSelf ? (
              <Text style={styles.selfTag} testID={`taster-self-${taster.id}`}>
                {t('taster_self')}
              </Text>
            ) : null}
          </View>
          <Pressable
            onPress={() => openEdit(taster)}
            accessibilityRole="button"
            testID={`edit-taster-${taster.id}`}
            style={styles.iconBtn}
          >
            <Icon name="edit" size={18} color="#5a4f63" />
          </Pressable>
          {/* Self-taster is undeletable — render no delete control for it. */}
          {taster.isSelf ? null : (
            <Pressable
              onPress={() => confirmDelete(taster)}
              accessibilityRole="button"
              testID={`delete-taster-${taster.id}`}
              style={styles.iconBtn}
            >
              <Icon name="trash" size={18} color="#c0392b" />
            </Pressable>
          )}
        </View>
      ))}

      <Button
        variant="secondary"
        block
        style={{ marginTop: 18 }}
        onPress={openCreate}
        testID="add-taster-btn"
        iconLeft={<Icon name="plus" size={18} color="#191017" />}
      >
        {t('taster_add')}
      </Button>

      {/* Create / edit bottom sheet */}
      <Modal
        visible={!!sheet}
        transparent
        animationType="slide"
        onRequestClose={closeSheet}
      >
        <Pressable style={modalStyles.sheetOverlay} onPress={closeSheet}>
          <KeyboardStickyView>
            <Pressable style={modalStyles.sheetContent} onPress={() => {}}>
              <Text style={modalStyles.modalTitle}>{sheetTitle}</Text>
              <Input
                label={t('taster_name_label')}
                value={nameValue}
                onChangeText={(v) => {
                  setNameValue(v)
                  setError('')
                }}
                testID="taster-name-input"
              />
              <View style={{ height: space[3] }} />
              <Input
                label={t('taster_avatar_label')}
                value={avatarValue}
                onChangeText={setAvatarValue}
                testID="taster-avatar-input"
              />
              {error ? (
                <Text style={modalStyles.errorText} testID="taster-error">
                  {error}
                </Text>
              ) : null}
              <View style={modalStyles.buttonRow}>
                <Button variant="ghost" onPress={closeSheet}>
                  {t('cancel')}
                </Button>
                <Button
                  variant="primary"
                  disabled={saving || !nameValue.trim()}
                  onPress={submitSheet}
                  testID="taster-save-btn"
                >
                  {t('save_taste')}
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
  kicker: {
    color: colors.ink400,
    fontSize: 10,
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  gateText: {
    color: colors.ink900,
    fontSize: 14,
    lineHeight: 20,
  },
  emptyText: {
    color: colors.ink500,
    fontSize: 14,
    marginTop: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingVertical: 12,
    paddingHorizontal: 2,
  },
  rowBorder: {
    borderBottomWidth: 2,
    borderBottomColor: colors.ink200,
    borderStyle: 'dotted',
  },
  rowLast: {
    borderBottomWidth: 0,
  },
  rowText: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
  },
  rowName: {
    color: colors.ink900,
    fontWeight: '500',
  },
  selfTag: {
    color: colors.ink400,
    fontSize: 10,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    borderWidth: 1,
    borderColor: colors.ink200,
    borderRadius: radius.sm,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  iconBtn: {
    padding: 6,
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
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
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
