/* ============================================================
   YUMMY OR NOT — Root layout (Expo Router)
   App-wide providers + the root Stack. Wraps everything in:
     • SafeAreaProvider  (safe-area insets for native)
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
import { KeyboardProvider } from 'react-native-keyboard-controller'
import { SafeAreaProvider } from 'react-native-safe-area-context'

import AppGate from '@/components/app/AppGate'
import { fontMapForLocale } from '@/constants/fonts'
import { AddTransitionProvider } from '@/providers/AddTransitionProvider'
import { AuthProvider } from '@/providers/AuthProvider'
import { I18nProvider } from '@/providers/I18nProvider'
import { LocationPickerProvider } from '@/providers/LocationPickerProvider'

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
      <KeyboardProvider>
        <I18nProvider>
          <AuthProvider>
            <StatusBar style="dark" />
            <AppGate>
              <AddTransitionProvider>
               <LocationPickerProvider>
                <Stack
                  screenOptions={{
                    headerShown: false,
                    contentStyle: { backgroundColor: '#fff6e6' },
                  }}
                >
                  <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
                  <Stack.Screen
                    name="add"
                    options={{
                      presentation: 'transparentModal',
                      headerShown: false,
                      animation: 'none',
                      contentStyle: { backgroundColor: 'transparent' },
                    }}
                  />
                  <Stack.Screen
                    name="taste/[id]"
                    options={{
                      presentation: 'card',
                      headerShown: false,
                    }}
                  />
                  {/* S3a — share import landing (deep link import/<token>) + code entry */}
                  <Stack.Screen
                    name="import/[token]"
                    options={{
                      presentation: 'card',
                      headerShown: false,
                    }}
                  />
                  <Stack.Screen
                    name="import-code"
                    options={{
                      presentation: 'card',
                      headerShown: false,
                    }}
                  />
                </Stack>
               </LocationPickerProvider>
              </AddTransitionProvider>
            </AppGate>
          </AuthProvider>
        </I18nProvider>
      </KeyboardProvider>
    </SafeAreaProvider>
  )
}
