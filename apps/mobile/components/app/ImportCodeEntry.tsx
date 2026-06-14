/* ============================================================
   YUMMY OR NOT — ImportCodeEntry (S3a)
   The "magic word" fallback: WeChat strips the deep link from forwarded share
   images, so the recipient types the short import code printed on the card.
   We resolve the code → a live token, then route to the import landing
   (/import/<token>) which previews + saves the taste.
   ============================================================ */

import { useState } from 'react'
import { ActivityIndicator, StyleSheet, View } from 'react-native'
import { useRouter } from 'expo-router'

import { parseShareToken, resolveImportCode } from '@yon/shared'
import { Button, Input } from '@/components/ds'
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

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>{t('import_code_entry')}</Text>
      <Text style={styles.body}>{t('import_code_hint')}</Text>

      <Input
        value={code}
        onChangeText={(v) => setCode(v.toUpperCase())}
        autoCapitalize="characters"
        autoCorrect={false}
        placeholder={t('import_code_placeholder')}
        error={error ?? undefined}
        testID="import-code-input"
      />

      <Button
        variant="primary"
        disabled={loading || !code.trim()}
        onPress={handleLookup}
        testID="import-code-submit"
      >
        {loading ? <ActivityIndicator color={colors.background} /> : t('import_code_lookup')}
      </Button>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: space[4],
    gap: space[3],
  },
  heading: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.ink900,
  },
  body: {
    color: colors.ink700,
  },
})
