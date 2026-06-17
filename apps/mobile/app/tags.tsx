/* ============================================================
   YUMMY OR NOT — /tags route (stack screen)
   Tag library management screen entry point.

   Uses the shared PageHeader (CENTERED title + top-left 取消) on a cream
   background instead of the default native header (white bg, left-aligned
   title, back-arrow) so it matches the rest of the app's chrome.
   ============================================================ */

import { Stack, useRouter } from 'expo-router'
import { Pressable, View } from 'react-native'
import TagManageView from '@/components/app/TagManageView'
import { PageHeader } from '@/components/app/PageHeader'
import { colors, Text } from '@/theme'
import { useI18n } from '@/providers/I18nProvider'

export default function TagsScreen() {
  const { t } = useI18n()
  const router = useRouter()
  // 取消 must always go somewhere sensible: pop the stack normally, but on a
  // direct/deep-linked entry (no back stack) fall back to the home tabs instead
  // of no-op'ing or exiting the app.
  const onCancel = () => {
    if (router.canGoBack()) router.back()
    else router.replace('/(tabs)')
  }
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack.Screen options={{ headerShown: false, presentation: 'card' }} />
      <PageHeader
        safeAreaTop
        title={t('tag_manage')}
        left={
          <Pressable
            testID="header-cancel"
            onPress={onCancel}
            hitSlop={8}
            accessibilityRole="button"
          >
            <Text style={{ fontSize: 16, color: colors.ink900 }}>{t('cancel')}</Text>
          </Pressable>
        }
      />
      <TagManageView />
    </View>
  )
}
