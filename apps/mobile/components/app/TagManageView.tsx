/* ============================================================
   YUMMY OR NOT — TagManageView (plain RN + theme, no Tamagui)
   Tag library management screen: rename and delete user tags.
   Uses the existing renameTag / deleteTag api-client functions
   and invalidateTagsCache to keep the shared tag cache consistent.
   ============================================================ */

import { useState } from 'react'
import { Alert, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { renameTag, deleteTag, type UserTag } from '@yon/shared'

import { ConfirmSheet, EditActionHeader, Icon, Input } from '@/components/ds'
import { invalidateTagsCache, useTags } from '@/app/(tabs)/_useTags'
import { colors, space, Text } from '@/theme'
import { useI18n } from '@/providers/I18nProvider'

export default function TagManageView() {
  const { t } = useI18n()
  const { tags, loading } = useTags()
  const insets = useSafeAreaInsets()

  // Rename modal state
  const [renaming, setRenaming] = useState<UserTag | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [renameError, setRenameError] = useState('')
  const [renameSaving, setRenameSaving] = useState(false)
  const [confirmCancelOpen, setConfirmCancelOpen] = useState(false)

  // True when the user has changed the value from the original tag name
  const renameDirty = !!renaming && renameValue.trim() !== renaming.name

  function openRename(tag: UserTag) {
    setRenaming(tag)
    setRenameValue(tag.name)
    setRenameError('')
  }

  function closeRename() {
    setRenaming(null)
    setRenameValue('')
    setRenameError('')
    setConfirmCancelOpen(false)
  }

  function requestCancelRename() {
    if (renameDirty) {
      setConfirmCancelOpen(true)
    } else {
      closeRename()
    }
  }

  async function submitRename() {
    if (!renaming) return
    const trimmed = renameValue.trim()
    if (!trimmed) return
    setRenameSaving(true)
    setRenameError('')
    try {
      await renameTag(renaming.id, { name: trimmed })
      invalidateTagsCache()
      closeRename()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('name_conflict')) {
        setRenameError(t('tag_name_conflict'))
      } else {
        setRenameError(msg)
      }
    } finally {
      setRenameSaving(false)
    }
  }

  function confirmDelete(tag: UserTag) {
    Alert.alert(
      t('tag_delete_confirm'),
      undefined,
      [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('del'),
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteTag(tag.id)
              invalidateTagsCache()
            } catch {
              // silent — list will re-render from cache
            }
          },
        },
      ]
    )
  }

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.container}>
      <Text style={styles.kicker}>{t('tag_manage')}</Text>

      {!loading && tags.length === 0 ? (
        <Text style={styles.emptyText}>{t('tag_empty')}</Text>
      ) : null}

      {tags.map((tag, idx) => (
        <View
          key={tag.id}
          style={[
            styles.tagRow,
            idx === tags.length - 1 ? styles.tagRowLast : styles.tagRowBorder,
          ]}
        >
          <Text style={styles.tagName}>{tag.name}</Text>
          <Pressable
            onPress={() => openRename(tag)}
            accessibilityRole="button"
            testID={`rename-tag-${tag.id}`}
            style={styles.iconBtn}
          >
            <Icon name="edit" size={18} color="#5a4f63" />
          </Pressable>
          <Pressable
            onPress={() => confirmDelete(tag)}
            accessibilityRole="button"
            testID={`delete-tag-${tag.id}`}
            style={styles.iconBtn}
          >
            <Icon name="del" size={18} color="#c0392b" />
          </Pressable>
        </View>
      ))}

      {/* Rename full-screen editor. Full-screen = pinned header + KeyboardAwareScrollView;
          no sticky footer, no RN built-in KeyboardAvoidingView (keyboard-ux.md rule). */}
      <Modal
        visible={!!renaming}
        animationType="slide"
        onRequestClose={requestCancelRename}
      >
        <View style={{ flex: 1, backgroundColor: colors.background }}>
          {/* Pinned top action bar: 取消 left · title center · save right (ADR 0001) */}
          <EditActionHeader
            onCancel={requestCancelRename}
            cancelLabel={t('cancel')}
            cancelTestID="rename-cancel-btn"
            title={t('tag_manage')}
            onPrimary={submitRename}
            primaryLabel={t('save')}
            primaryTestID="rename-confirm-btn"
            primaryDisabled={renameSaving || !renameValue.trim()}
            primaryLoading={renameSaving}
          />
          <KeyboardAwareScrollView
            bottomOffset={16}
            style={{ flex: 1 }}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: insets.bottom + 16 }}
          >
            <Input
              label={t('tag_rename')}
              value={renameValue}
              onChangeText={(v) => {
                setRenameValue(v)
                setRenameError('')
              }}
              testID="rename-tag-input"
            />
            {renameError ? (
              <Text style={modalStyles.errorText} testID="rename-error">
                {renameError}
              </Text>
            ) : null}
          </KeyboardAwareScrollView>

          {/* Dirty-cancel guard — absolute overlay, NOT a nested Modal (ConfirmSheet design) */}
          <ConfirmSheet
            visible={confirmCancelOpen}
            title={t('discard_changes_title')}
            body={t('discard_changes_body')}
            confirmLabel={t('discard_confirm')}
            destructive
            onConfirm={() => { setConfirmCancelOpen(false); closeRename() }}
            onDismiss={() => setConfirmCancelOpen(false)}
            testID="tag-cancel-confirm"
          />
        </View>
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
  emptyText: {
    color: colors.ink500,
    fontSize: 14,
    marginTop: 8,
  },
  tagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingVertical: 14,
    paddingHorizontal: 2,
  },
  tagRowBorder: {
    borderBottomWidth: 2,
    borderBottomColor: colors.ink200,
    borderStyle: 'dotted',
  },
  tagRowLast: {
    borderBottomWidth: 0,
  },
  tagName: {
    flex: 1,
    color: colors.ink900,
    fontWeight: '500',
  },
  iconBtn: {
    padding: 6,
  },
})

const modalStyles = StyleSheet.create({
  errorText: {
    color: colors.verdictNah2,
    fontSize: 13,
    marginTop: 8,
  },
})
