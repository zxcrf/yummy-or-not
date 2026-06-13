/* ============================================================
   YUMMY OR NOT — AppGate (React Native, mobile-only)
   The signed-in gate. While the session is loading it shows a minimal
   centered splash; once resolved it renders the app for signed-in users
   or the AuthScreen otherwise.
   ============================================================ */

import { type ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'

import { colors } from '@/theme'
import { Icon } from '@/components/ds'
import { useAuth } from '@/providers/AuthProvider'
import AuthScreen from './AuthScreen'
import { useShareTokenImport } from './useShareTokenImport'

interface Props {
  children: ReactNode
}

export default function AppGate({ children }: Props) {
  const { user, loading } = useAuth()
  // S3a 可导入 foreground auto-detect. AppGate renders for the loading and
  // signed-out states too, so the hook MUST stay inert until there is a user:
  // it reads `useAuth().user` internally and registers NO AppState subscription
  // and does NO clipboard read while signed-out/loading. This avoids the iOS
  // paste-permission toast and a 401 resolve against an unauthenticated session.
  // Once the user appears the hook's effect re-runs and subscribes for the
  // signed-in lifetime. Mounting it here (rather than below the auth guard)
  // keeps the subscription stable across the children re-render.
  useShareTokenImport()

  if (loading) {
    return (
      <View style={styles.splash}>
        <Icon name="heart" size={48} color="#ff2e88" />
      </View>
    )
  }

  return user ? <>{children}</> : <AuthScreen />
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
})
