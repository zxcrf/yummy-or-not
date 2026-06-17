/* ============================================================
   YUMMY OR NOT — Taste detail route (/taste/[id])
   Thin wrapper around components/app/DetailView. Frames the screen with
   the cream background. DetailView (sibling-owned) reads the `id` route
   param itself via useLocalSearchParams, owns its data fetch / close /
   delete flow, and applies the top safe-area inset itself once (so
   edit mode applies the inset exactly once via EditActionHeader, and read
   mode applies it once via the read-mode photo wrapper).
   ============================================================ */

import { StyleSheet, View } from 'react-native'

import { colors } from '@/theme'
import DetailView from '@/components/app/DetailView'

export default function TasteDetailRoute() {
  return (
    <View testID="taste-detail-container" style={styles.container}>
      <DetailView />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
})
