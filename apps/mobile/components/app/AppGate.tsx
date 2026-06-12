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

interface Props {
  children: ReactNode
}

export default function AppGate({ children }: Props) {
  const { user, loading } = useAuth()

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
