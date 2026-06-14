/* ============================================================
   YUMMY OR NOT — /family route (stack screen)
   Shared family / member taste stream (S3c). Renders the coarsened
   GeoFeedCard list from GET /api/feed/family.
   ============================================================ */

import { Stack } from 'expo-router'
import FamilyFeedView from '@/components/app/FamilyFeedView'
import { useI18n } from '@/providers/I18nProvider'

export default function FamilyScreen() {
  const { t } = useI18n()
  return (
    <>
      <Stack.Screen
        options={{
          title: t('family_feed'),
          headerShown: true,
          presentation: 'card',
        }}
      />
      <FamilyFeedView />
    </>
  )
}
