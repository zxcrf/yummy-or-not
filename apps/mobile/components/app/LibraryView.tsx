/* ============================================================
   YUMMY OR NOT — LibraryView (Tamagui / React Native)
   Browse logged tastes: search by name/place, filter chips, and a
   grid/list of FoodCards. Loading + empty states. Tapping a card
   routes to /taste/[id]. Ported from the web src/components/app/
   LibraryView.tsx — data is fetched here (not passed as props) and
   navigation uses expo-router instead of an onOpen callback.
   ============================================================ */

import { useCallback, useMemo, useState } from 'react'
import { ActivityIndicator, RefreshControl, useWindowDimensions } from 'react-native'
import { useRouter } from 'expo-router'
import { ScrollView, Text, View, XStack, YStack } from 'tamagui'
import { FILTERS } from '@yon/shared'
import { FoodCard, Icon, Input, Tag } from '@/components/ds'
import { useI18n } from '@/providers/I18nProvider'
import { useRefreshableTastes } from '@/app/(tabs)/_useTastes'

export default function LibraryView() {
  const { t, formatMoney } = useI18n()
  const router = useRouter()
  const { width } = useWindowDimensions()
  const isDesktop = width >= 768

  const { items, loading, refresh } = useRefreshableTastes()
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

  const shown = useMemo(
    () =>
      items.filter((it) => {
        const okFilter =
          filter === 'All' ||
          it.tags.includes(filter) ||
          it.name.toLowerCase().includes(filter.toLowerCase())
        const okQuery =
          !query ||
          it.name.toLowerCase().includes(query.toLowerCase()) ||
          it.place.toLowerCase().includes(query.toLowerCase())
        return okFilter && okQuery
      }),
    [items, query, filter]
  )

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

      {/* filter chips */}
      <XStack flexWrap="wrap" gap="$2">
        {FILTERS.map((f) => (
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
