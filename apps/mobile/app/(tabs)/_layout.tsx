/* ============================================================
   YUMMY OR NOT — Tab navigator (Expo Router)
   Mirrors the web AppShell responsive chrome:
     • narrow (phones)  → fixed bottom tab bar + center FAB
     • wide   (≥ md/web) → left sidebar nav

   Routing is handled by expo-router's <Tabs>; the chrome is a fully
   custom `tabBar` (AppNav) that swaps bottom-bar ↔ sidebar via the
   Tamagui `gtMd` media query. The sections map to the shell:
   Library / Add (center FAB) / To-Try / You. Recall is folded into
   Library — searching the 口味 list surfaces past verdicts.
   ============================================================ */

import { Tabs } from 'expo-router'

import { AppNav } from './_nav'

export default function TabsLayout() {
  return (
    <Tabs
      tabBar={(props) => <AppNav {...props} />}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: '#fff6e6' },
        // Restrained cross-tab transition: Material "shift" (subtle slide +
        // crossfade) on every tab change, so switching never hard-snaps.
        animation: 'shift',
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Library' }} />
      <Tabs.Screen name="todo" options={{ title: 'To-Try' }} />
      <Tabs.Screen name="you" options={{ title: 'You' }} />
    </Tabs>
  )
}
