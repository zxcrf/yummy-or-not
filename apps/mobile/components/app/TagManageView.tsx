/* ============================================================
   YUMMY OR NOT — TagManageView (plain RN + theme, no Tamagui)
   Tag library management screen: rename and delete user tags.
   Uses the existing renameTag / deleteTag api-client functions
   and invalidateTagsCache to keep the shared tag cache consistent.
   ============================================================ */

import { useState } from 'react'
import { Alert, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { renameTag, deleteTag, type UserTag } from '@yon/shared'

import { Button, Icon, Input } from '@/components/ds'
import { invalidateTagsCache, useTags } from '@/app/(tabs)/_useTags'
import { colors, space, radius, Text } from '@/theme'
import { useI18n } from '@/providers/I18nProvider'

export default function TagManageView() {
  const { t } = useI18n()
  const { tags, loading } = useTags()

  // Rename modal state
  const [renaming, setRenaming] = useState<UserTag | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [renameError, setRenameError] = useState('')
  const [renameSaving, setRenameSaving] = useState(false)

  function openRename(tag: UserTag) {
    setRenaming(tag)
    setRenameValue(tag.name)
    setRenameError('')
  }

  function closeRename() {
    setRenaming(null)
    setRenameValue('')
    setRenameError('')
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

      {/* Rename modal */}
      <Modal
        visible={!!renaming}
        transparent
        animationType="slide"
        onRequestClose={closeRename}
      >
        <Pressable style={modalStyles.sheetOverlay} onPress={closeRename}>
          <Pressable style={modalStyles.sheetContent} onPress={() => {}}>
            <Text style={modalStyles.modalTitle}>{t('tag_rename')}</Text>
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
            <View style={modalStyles.buttonRow}>
              <Button variant="ghost" onPress={closeRename}>
                {t('cancel')}
              </Button>
              <Button
                variant="primary"
                disabled={renameSaving || !renameValue.trim()}
                onPress={submitRename}
                testID="rename-confirm-btn"
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
