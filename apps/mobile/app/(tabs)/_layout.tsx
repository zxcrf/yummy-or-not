/* ============================================================
   YUMMY OR NOT — Tab navigator (Expo Router)
   Mirrors the web AppShell responsive chrome:
     • narrow (phones)  → fixed bottom tab bar + center FAB
     • wide   (≥ md/web) → left sidebar nav

   Routing is handled by expo-router's <Tabs>; the chrome is a fully
   custom `tabBar` (AppNav) that swaps bottom-bar ↔ sidebar via the
   Tamagui `gtMd` media query. The five sections map 1:1 to the web
   shell: Library / Recall / Add (center FAB) / Stats / You.
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
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Library' }} />
      <Tabs.Screen name="recall" options={{ title: 'Recall' }} />
      <Tabs.Screen name="stats" options={{ title: 'Stats' }} />
      <Tabs.Screen name="you" options={{ title: 'You' }} />
    </Tabs>
  )
}
