/* ============================================================
   YUMMY OR NOT — Taste detail route (/taste/[id])
   Thin wrapper around components/app/DetailView. Frames the screen with
   the cream background + top inset. DetailView (sibling-owned) reads the
   `id` route param itself via useLocalSearchParams and owns its data
   fetch / close / delete flow.
   ============================================================ */

import { StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { colors } from '@/theme'
import DetailView from '@/components/app/DetailView'

export default function TasteDetailRoute() {
  const insets = useSafeAreaInsets()
  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
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
