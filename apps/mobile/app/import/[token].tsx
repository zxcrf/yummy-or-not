/* ============================================================
   YUMMY OR NOT — Import landing route (/import/[token])
   Reached via the deep link `yummyornot://import/<token>` (S3a). Thin wrapper
   around components/app/ImportLanding, which reads the `token` route param,
   previews the shared taste, and saves it to the user's 想吃 list on confirm.
   ============================================================ */

import { StyleSheet, View } from 'react-native'

import { colors } from '@/theme'
import ImportLanding from '@/components/app/ImportLanding'

export default function ImportTokenRoute() {
  // The EditActionHeader inside ImportLanding owns the top safe-area inset
  // (variant='screen'), so the wrapper must NOT add paddingTop or the header
  // would be double-inset.
  return (
    <View style={styles.container}>
      <ImportLanding />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
})
