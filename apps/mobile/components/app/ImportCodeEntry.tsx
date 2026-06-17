/* ============================================================
   YUMMY OR NOT — ImportCodeEntry (S3a)
   The "magic word" fallback: WeChat strips the deep link from forwarded share
   images, so the recipient types the short import code printed on the card.
   We resolve the code → a live token, then route to the import landing
   (/import/<token>) which previews + saves the taste.
   ============================================================ */

import { useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { useRouter } from 'expo-router'

import { parseShareToken, resolveImportCode } from '@yon/shared'
import { EditActionHeader, Input } from '@/components/ds'
import { useI18n } from '@/providers/I18nProvider'
import { colors, space, Text } from '@/theme'

export default function ImportCodeEntry() {
  const { t } = useI18n()
  const router = useRouter()

  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleLookup = async () => {
    const trimmed = code.trim()
    if (!trimmed || loading) return
    setLoading(true)
    setError(null)
    try {
      const resolvedCode = parseShareToken(trimmed) ?? trimmed
      const { token } = await resolveImportCode(resolvedCode)
      router.replace(`/import/${token}`)
    } catch {
      // 404 / any failure → the code does not map to a live share.
      setError(t('import_code_not_found'))
    } finally {
      setLoading(false)
    }
  }

  const handleCancel = () => {
    if (router.canGoBack()) router.back()
    else router.replace('/(tabs)')
  }

  return (
    <View style={styles.root}>
      <EditActionHeader
        onCancel={handleCancel}
        cancelLabel={t('cancel')}
        cancelTestID="import-code-cancel"
        title={t('import_code_entry')}
        onPrimary={handleLookup}
        primaryLabel={t('import_code_lookup')}
        primaryDisabled={loading || !code.trim()}
        primaryLoading={loading}
        primaryTestID="import-code-submit"
      />

      <View style={styles.body}>
        <Text style={styles.hint}>{t('import_code_hint')}</Text>

        <Input
          value={code}
          onChangeText={(v) => setCode(v.toUpperCase())}
          autoCapitalize="characters"
          autoCorrect={false}
          placeholder={t('import_code_placeholder')}
          error={error ?? undefined}
          testID="import-code-input"
        />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  body: {
    flex: 1,
    padding: space[4],
    gap: space[3],
  },
  hint: {
    color: colors.ink700,
  },
})
