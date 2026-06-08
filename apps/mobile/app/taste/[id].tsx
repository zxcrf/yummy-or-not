/* ============================================================
   YUMMY OR NOT — Taste detail route (/taste/[id])
   Thin wrapper around components/app/DetailView. Frames the screen with
   the cream background + top inset. DetailView (sibling-owned) reads the
   `id` route param itself via useLocalSearchParams and owns its data
   fetch / close / delete flow.
   ============================================================ */

import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { View } from 'tamagui'

import DetailView from '@/components/app/DetailView'

export default function TasteDetailRoute() {
  const insets = useSafeAreaInsets()
  return (
    <View flex={1} backgroundColor="$background" paddingTop={insets.top}>
      <DetailView />
    </View>
  )
}
