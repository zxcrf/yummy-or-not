/* ============================================================
   YUMMY OR NOT — Import-code entry route (/import-code)
   Reached from the You page "enter import code" row (S3a). Thin wrapper around
   components/app/ImportCodeEntry, which resolves the typed code → a token and
   forwards to the /import/<token> landing.
   ============================================================ */

import { StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { colors } from '@/theme'
import ImportCodeEntry from '@/components/app/ImportCodeEntry'

export default function ImportCodeRoute() {
  const insets = useSafeAreaInsets()
  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ImportCodeEntry />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
})
