/* ============================================================
   YUMMY OR NOT — /family route (stack screen)

   "家人" — the single merged family screen (S3b). Replaces the former
   separate /tasters (口味家人) + /family (家人的口味) pair: it lists family
   members (personas) with add / edit / delete, and tapping a member enters
   that member's 口味 (sets them as the active taster and jumps to the
   library, which then filters to their tastes). Pro-gated inside
   TasterManageView.

   Uses the shared PageHeader (CENTERED title + top-left 取消) on a cream
   background instead of the default native header so it matches the rest
   of the app's chrome.
   ============================================================ */

import { Stack, useRouter } from 'expo-router'
import { Pressable, View } from 'react-native'
import TasterManageView from '@/components/app/TasterManageView'
import { PageHeader } from '@/components/app/PageHeader'
import { colors, Text } from '@/theme'
import { useI18n } from '@/providers/I18nProvider'

export default function FamilyScreen() {
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
        title={t('family_entry')}
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
      <TasterManageView />
    </View>
  )
}
