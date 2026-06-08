/* ============================================================
   YUMMY OR NOT — AppGate (Tamagui / React Native + RN Web)
   The signed-in gate. While the session is loading it shows a minimal
   centered splash; once resolved it renders the app for signed-in users
   or the AuthScreen otherwise.
   ============================================================ */

import { type ReactNode } from 'react'
import { View } from 'tamagui'

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
      <View
        flex={1}
        alignItems="center"
        justifyContent="center"
        backgroundColor="$background"
      >
        <Icon name="heart" size={48} color="#ff2e88" />
      </View>
    )
  }

  return user ? <>{children}</> : <AuthScreen />
}
