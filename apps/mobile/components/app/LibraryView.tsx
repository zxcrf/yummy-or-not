/* ============================================================
   YUMMY OR NOT — LibraryView (Tamagui / React Native)
   Browse logged tastes: search by name/place/notes (ranked), filter
   chips from the user's tag candidate set, and a grid/list of FoodCards.
   Loading + empty states. Tapping a card routes to /taste/[id].
   ============================================================ */

import { useCallback, useMemo, useState } from 'react'
import { ActivityIndicator, RefreshControl, useWindowDimensions } from 'react-native'
import { useRouter } from 'expo-router'
import { ScrollView, Text, View, XStack, YStack } from 'tamagui'
import { searchTastes } from '@yon/shared'
import { FoodCard, Icon, Input, Tag } from '@/components/ds'
import { useI18n } from '@/providers/I18nProvider'
import { useRefreshableTastes } from '@/app/(tabs)/_useTastes'
import { useTags } from '@/app/(tabs)/_useTags'

export default function LibraryView() {
  const { t, formatMoney } = useI18n()
  const router = useRouter()
  const { width } = useWindowDimensions()
  const isDesktop = width >= 768

  const { items, loading, refresh } = useRefreshableTastes()
  const { tags } = useTags()
  const [refreshing, setRefreshing] = useState(false)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<string>('All')

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    try {
      await refresh()
    } finally {
      setRefreshing(false)
    }
  }, [refresh])

  // Filter chips: "All" sentinel always first, then the user's tag candidate set.
  const filterChips = useMemo(
    () => ['All', ...tags.map((tg) => tg.name)],
    [tags],
  )

  const shown = useMemo(() => {
    // Tag/name filter first (pure boolean — no scoring needed).
    const filtered =
      filter === 'All'
        ? items
        : items.filter(
            (it) =>
              it.tags.includes(filter) ||
              it.name.toLowerCase().includes(filter.toLowerCase()),
          )

    // Search: use scored searchTastes so notes are included and results are ranked.
    // When query is empty/too-short, searchTastes returns [] — fall back to full list.
    if (!query || query.trim().length <= 1) return filtered

    const results = searchTastes(filtered, query)
    return results.map((r) => r.item)
  }, [items, query, filter])

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
            {t('your_tastes')}
          </Text>
          <Text color="$colorMuted" fontSize={13}>
            {t('count_logged', { n: items.length })}
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

      {/* filter chips — sourced from user's tag candidate set */}
      <XStack flexWrap="wrap" gap="$2">
        {filterChips.map((f) => (
          <Tag key={f} active={filter === f} onPress={() => setFilter(f)}>
            {f === 'All' ? t('all') : f}
          </Tag>
        ))}
      </XStack>

      {/* grid */}
      {loading ? (
        <YStack alignItems="center" paddingVertical={48}>
          <ActivityIndicator color="#191017" />
        </YStack>
      ) : shown.length === 0 ? (
        <YStack alignItems="center" paddingVertical={48} gap="$2">
          <Icon name="reciept" size={40} color="#b8aeb4" />
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
                verdict={it.verdict}
                tags={it.tags}
                boughtCount={it.boughtCount}
                boughtLabel={t('bought_n', { n: it.boughtCount })}
                verdictLabel={t('v_' + it.verdict)}
                onPress={() => router.push(`/taste/${it.id}`)}
              />
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  )
}
