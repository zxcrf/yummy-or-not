/* ============================================================
   YUMMY OR NOT — ImportLanding (S3a)
   The landing screen reached via the deep link `yummyornot://import/<token>`
   (or the "enter import code" entry, which resolves a code → token first).
   Reads the `token` route param, fetches a LIVE preview via getSharePreview,
   renders a preview card, and on "save to my to-taste" calls importShare then
   routes to the Library todo tab.

   A revoked / expired / source-deleted share surfaces a "no longer available"
   state (getSharePreview throws "share_gone") and offers no save button.
   ============================================================ */

import { useEffect, useState } from 'react'
import { ActivityIndicator, Image, StyleSheet, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'

import { getSharePreview, importShare, type SharePreview } from '@yon/shared'
import { Badge, Button, Card, EditActionHeader, Tag, VerdictStamp } from '@/components/ds'
import { useI18n } from '@/providers/I18nProvider'
import { colors, radius, space, Text } from '@/theme'

export default function ImportLanding() {
  const { t, formatMoney } = useI18n()
  const router = useRouter()
  const params = useLocalSearchParams<{ token: string }>()
  const token = Array.isArray(params.token) ? params.token[0] : params.token

  const [preview, setPreview] = useState<SharePreview | null>(null)
  const [loading, setLoading] = useState(true)
  // The share is unavailable (revoked / expired / source deleted → 410).
  const [gone, setGone] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let alive = true
    if (!token) {
      setLoading(false)
      setGone(true)
      return
    }
    setLoading(true)
    setGone(false)
    getSharePreview(token)
      .then((p) => {
        if (!alive) return
        setPreview(p)
        setLoading(false)
      })
      .catch(() => {
        if (!alive) return
        // 410 / any preview failure → unavailable state, no save offered.
        setGone(true)
        setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [token])

  const handleSave = async () => {
    if (!token || saving) return
    setSaving(true)
    try {
      await importShare(token)
      // Land in the Library todo (想吃) tab where the new copy appears.
      router.replace('/(tabs)/todo')
    } catch {
      // Source revoked between preview and save — surface the unavailable state.
      setGone(true)
    } finally {
      setSaving(false)
    }
  }

  // Exit affordance present on every branch so the user is never stranded.
  // Falls back to the home tabs when there is no back stack (cold deep-link entry).
  const handleCancel = () => {
    if (router.canGoBack()) router.back()
    else router.replace('/(tabs)')
  }

  if (loading) {
    return (
      <View style={styles.screen} testID="import-loading">
        <EditActionHeader
          onCancel={handleCancel}
          cancelLabel={t('cancel')}
          cancelTestID="import-cancel-btn"
          title={t('import_preview_title')}
          onPrimary={handleSave}
          primaryLabel={t('import_save_to_todo')}
          primaryDisabled
          primaryTestID="import-save-btn"
        />
        <View style={styles.center}>
          <ActivityIndicator color={colors.ink900} />
        </View>
      </View>
    )
  }

  if (gone || !preview) {
    return (
      <View style={styles.screen} testID="import-unavailable">
        <EditActionHeader
          onCancel={handleCancel}
          cancelLabel={t('cancel')}
          cancelTestID="import-cancel-btn"
          title={t('share_unavailable')}
          onPrimary={() => {}}
          primaryLabel={t('import_save_to_todo')}
          primaryDisabled
          primaryIcon={null}
        />
        <View style={styles.center}>
          <Text style={styles.unavailableTitle}>{t('share_unavailable')}</Text>
          <Text style={styles.unavailableBody}>{t('share_unavailable_body')}</Text>
          <Button variant="secondary" onPress={() => router.replace('/(tabs)')} testID="import-back-btn">
            {t('import_back_home')}
          </Button>
        </View>
      </View>
    )
  }

  return (
    <View style={styles.screen}>
      <EditActionHeader
        onCancel={handleCancel}
        cancelLabel={t('cancel')}
        cancelTestID="import-cancel-btn"
        title={t('import_preview_title')}
        onPrimary={handleSave}
        primaryLabel={t('import_save_to_todo')}
        primaryDisabled={saving}
        primaryLoading={saving}
        primaryTestID="import-save-btn"
      />

      <View style={styles.body}>
      <Card style={styles.card}>
        {preview.photoUrl ? (
          <Image source={{ uri: preview.photoUrl }} style={styles.photo} testID="import-photo" />
        ) : null}

        <View style={styles.headerRow}>
          <Text style={styles.name} testID="import-name">{preview.name}</Text>
          {preview.verdict ? (
            <VerdictStamp verdict={preview.verdict} label={t('v_' + preview.verdict)} />
          ) : null}
        </View>

        {preview.place ? <Text style={styles.place}>{preview.place}</Text> : null}
        {preview.price ? <Badge>{formatMoney(preview.price)}</Badge> : null}

        {preview.tags?.length ? (
          <View style={styles.tagRow}>
            {preview.tags.map((tg) => (
              <Tag key={tg}>{tg}</Tag>
            ))}
          </View>
        ) : null}

        {preview.notes ? <Text style={styles.notes}>{preview.notes}</Text> : null}
      </Card>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  body: {
    flex: 1,
    padding: space[4],
    gap: space[3],
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space[4],
    gap: space[2],
  },
  card: {
    gap: space[2],
    padding: space[3],
    borderRadius: radius.lg,
  },
  photo: {
    width: '100%',
    height: 200,
    borderRadius: radius.md,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  name: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.ink900,
    flexShrink: 1,
  },
  place: {
    color: colors.ink700,
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space[1],
  },
  notes: {
    color: colors.ink700,
  },
  unavailableTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.ink900,
  },
  unavailableBody: {
    color: colors.ink700,
    textAlign: 'center',
  },
})
