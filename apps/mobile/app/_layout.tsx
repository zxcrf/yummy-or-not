/* ============================================================
   YUMMY OR NOT — Root layout (Expo Router)
   App-wide providers + the root Stack. Wraps everything in:
     • SafeAreaProvider  (safe-area insets for native + web)
     • TamaguiProvider   (theme "yum")
     • I18nProvider      (lang state + t(), persisted)
   Loads the pixel/CJK fonts (system-font fallback until the .ttf
   binaries are bundled — see constants/fonts.ts) and hides the splash
   screen once font loading resolves.
   ============================================================ */

import { useFonts } from 'expo-font'
import { Stack } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import { StatusBar } from 'expo-status-bar'
import { useEffect } from 'react'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { TamaguiProvider, Theme } from 'tamagui'

import AppGate from '@/components/app/AppGate'
import { fontMapForLocale } from '@/constants/fonts'
import { AuthProvider } from '@/providers/AuthProvider'
import { I18nProvider } from '@/providers/I18nProvider'
import { tamaguiConfig } from '../tamagui.config'

export {
  // Catch any errors thrown by the Layout component.
  ErrorBoundary,
} from 'expo-router'

export const unstable_settings = {
  // Tabs are the app's home; the detail route stacks above them.
  initialRouteName: '(tabs)',
}

// Prevent the splash screen from auto-hiding before fonts load.
SplashScreen.preventAutoHideAsync()

export default function RootLayout() {
  // fontMapForLocale is keyed off the active locale; once the CJK/Latin pixel
  // .ttf files are bundled (constants/fonts.ts) it returns them per locale.
  // Until then the map is empty (system-font fallback) so loading resolves
  // instantly. We load the default-locale ("zh") set at the root; per-locale
  // swapping can be layered on later without changing the splash gate.
  const [loaded, error] = useFonts(fontMapForLocale('zh'))

  useEffect(() => {
    if (error) throw error
  }, [error])

  useEffect(() => {
    if (loaded) {
      SplashScreen.hideAsync()
    }
  }, [loaded])

  if (!loaded) {
    return null
  }

  return (
    <SafeAreaProvider>
      <TamaguiProvider config={tamaguiConfig} defaultTheme="yum">
        <Theme name="yum">
          <I18nProvider>
            <AuthProvider>
              <StatusBar style="dark" />
              <AppGate>
                <Stack
                  screenOptions={{
                    headerShown: false,
                    contentStyle: { backgroundColor: '#fff6e6' },
                  }}
                >
                  <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
                  <Stack.Screen
                    name="taste/[id]"
                    options={{
                      // Detail opens as a card over the tabs (drawer-equivalent).
                      presentation: 'card',
                      headerShown: false,
                    }}
                  />
                </Stack>
              </AppGate>
            </AuthProvider>
          </I18nProvider>
        </Theme>
      </TamaguiProvider>
    </SafeAreaProvider>
  )
}
