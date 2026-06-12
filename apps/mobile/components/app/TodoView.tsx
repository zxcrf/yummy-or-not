/* ============================================================
   YUMMY OR NOT — TodoView (Tamagui / React Native)
   The 想吃 (to-try / wishlist) tab: a grid of the user's `status='todo'`
   records. Mirrors LibraryView's card grid + search, but is locked to
   todo items (LibraryView is now tasted-only). Tapping a card routes to
   /taste/[id]. Loading + empty states.
   ============================================================ */

import { useCallback, useMemo, useState } from 'react'
import { ActivityIndicator, RefreshControl, useWindowDimensions } from 'react-native'
import * as ExpoRouter from 'expo-router'
import { ScrollView, Text, View, XStack, YStack } from 'tamagui'
import { searchTastes } from '@yon/shared'
import { FoodCard, Icon, Input } from '@/components/ds'
import { useI18n } from '@/providers/I18nProvider'
import { useRefreshableTastes } from '@/app/(tabs)/_useTastes'

export default function TodoView() {
  const { t, formatMoney } = useI18n()
  const router = ExpoRouter.useRouter()
  const { width } = useWindowDimensions()
  const isDesktop = width >= 768

  const { items, loading, refresh } = useRefreshableTastes()
  const [refreshing, setRefreshing] = useState(false)
  const [query, setQuery] = useState('')

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    try {
      await refresh()
    } finally {
      setRefreshing(false)
    }
  }, [refresh])

  const shown = useMemo(() => {
    // This tab is exclusively the todo partition.
    const todos = items.filter((it) => (it.status ?? 'tasted') === 'todo')

    // Search: scored searchTastes (notes included, ranked). Empty/short query
    // returns [] from searchTastes — fall back to the full todo list.
    if (!query || query.trim().length <= 1) return todos
    return searchTastes(todos, query).map((r) => r.item)
  }, [items, query])

  return (
    <ScrollView
      flex={1}
      backgroundColor="$background"
      contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 40 }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor="#191017"
          colors={['#191017']}
        />
      }
    >
      {/* header */}
      <YStack gap="$3">
        <XStack alignItems="center" justifyContent="space-between" gap="$2">
          <Text color="$color" fontWeight="700" fontSize={28}>
            {t('nav_todo')}
          </Text>
          <Text color="$colorMuted" fontSize={13}>
            {t('count_logged', { n: items.filter((it) => (it.status ?? 'tasted') === 'todo').length })}
          </Text>
        </XStack>

        {/* search box */}
        <View position="relative" justifyContent="center">
          <View position="absolute" left={12} zIndex={1}>
            <Icon name="search" size={18} color="#857a82" />
          </View>
          <Input
            value={query}
            onChangeText={setQuery}
            placeholder={t('search_log')}
            paddingLeft={38}
            aria-label={t('search_log')}
          />
        </View>
      </YStack>

      {/* grid */}
      {loading ? (
        <YStack alignItems="center" paddingVertical={48}>
          <ActivityIndicator color="#191017" />
        </YStack>
      ) : shown.length === 0 ? (
        <YStack alignItems="center" paddingVertical={48} gap="$2">
          <Icon name="bookmark" size={40} color="#b8aeb4" />
          <Text color="$colorMuted">{t('nothing_here')}</Text>
        </YStack>
      ) : (
        <View
          flexDirection={isDesktop ? 'row' : 'column'}
          flexWrap={isDesktop ? 'wrap' : 'nowrap'}
          gap="$3"
        >
          {shown.map((it) => (
            <View key={it.id} style={isDesktop ? { width: '48%' } : undefined}>
              <FoodCard
                imageThumb={it.imageThumb || undefined}
                image={it.image || undefined}
                imageKey={it.imageKey || undefined}
                name={it.name}
                place={it.place}
                price={formatMoney(it.price)}
                status={it.status}
                verdict={it.verdict}
                tags={it.tags}
                boughtCount={it.boughtCount}
                boughtLabel={t('bought_n', { n: it.boughtCount })}
                todoLabel={t('todo_badge')}
                onPress={() => router.push(`/taste/${it.id}`)}
              />
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  )
}
