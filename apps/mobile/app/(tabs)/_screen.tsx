/* ============================================================
   YUMMY OR NOT — Screen (tab route content wrapper)
   Thin layout frame shared by every tab route. Provides the cream
   background, top safe-area inset, and — on wide layouts — the left
   gutter equal to the docked Sidebar width so screen bodies never sit
   under the sidebar. Screen BODIES live in components/app/* (owned by
   sibling agents); this only frames them.
   ============================================================ */

import { type ReactNode } from 'react'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { View, useMedia } from 'tamagui'

import { SIDEBAR_W } from './_nav'

export function Screen({ children }: { children: ReactNode }) {
  const media = useMedia()
  const insets = useSafeAreaInsets()
  return (
    <View
      flex={1}
      backgroundColor="$background"
      paddingTop={insets.top}
      paddingLeft={media.gtMd ? SIDEBAR_W : 0}
    >
      {children}
    </View>
  )
}
