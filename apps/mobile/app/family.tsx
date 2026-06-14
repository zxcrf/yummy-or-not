/* ============================================================
   YUMMY OR NOT — /family route (stack screen)

   "家人" — the single merged family screen (S3b). Replaces the former
   separate /tasters (口味家人) + /family (家人的口味) pair: it lists family
   members (personas) with add / edit / delete, and tapping a member enters
   that member's 口味 (sets them as the active taster and jumps to the
   library, which then filters to their tastes). Pro-gated inside
   TasterManageView.
   ============================================================ */

import { Stack } from 'expo-router'
import TasterManageView from '@/components/app/TasterManageView'
import { useI18n } from '@/providers/I18nProvider'

export default function FamilyScreen() {
  const { t } = useI18n()
  return (
    <>
      <Stack.Screen
        options={{
          title: t('family_entry'),
          headerShown: true,
          presentation: 'card',
        }}
      />
      <TasterManageView />
    </>
  )
}
