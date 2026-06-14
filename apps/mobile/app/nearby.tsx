/* ============================================================
   YUMMY OR NOT — /nearby route (stack screen)
   "附近 · 热力" AMap heatmap entry point. The screen itself owns the
   AMap privacy-consent gate and the native MapView, so the route only
   wires the header + renders <NearbyHeatView/>.
   ============================================================ */

import { Stack } from 'expo-router'
import NearbyHeatView from '@/components/app/NearbyHeatView'

export default function NearbyScreen() {
  return (
    <>
      <Stack.Screen
        options={{
          title: '附近 · 热力',
          headerShown: true,
          presentation: 'card',
        }}
      />
      <NearbyHeatView />
    </>
  )
}
