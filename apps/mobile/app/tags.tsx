/* ============================================================
   YUMMY OR NOT — /tags route (stack screen)
   Tag library management screen entry point.
   ============================================================ */

import { Stack } from 'expo-router'
import TagManageView from '@/components/app/TagManageView'
import { useI18n } from '@/providers/I18nProvider'

export default function TagsScreen() {
  const { t } = useI18n()
  return (
    <>
      <Stack.Screen
        options={{
          title: t('tag_manage'),
          headerShown: true,
          presentation: 'card',
        }}
      />
      <TagManageView />
    </>
  )
}
