/* ============================================================
   YUMMY OR NOT — /tasters route (stack screen)
   Taster persona management screen (S3b): list / create / rename /
   delete personas. Pro-gated inside TasterManageView.
   ============================================================ */

import { Stack } from 'expo-router'
import TasterManageView from '@/components/app/TasterManageView'
import { useI18n } from '@/providers/I18nProvider'

export default function TastersScreen() {
  const { t } = useI18n()
  return (
    <>
      <Stack.Screen
        options={{
          title: t('taster_manage'),
          headerShown: true,
          presentation: 'card',
        }}
      />
      <TasterManageView />
    </>
  )
}
