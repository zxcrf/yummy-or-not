/* ============================================================
   YUMMY OR NOT — TodoView (plain RN + theme)
   The 想吃 (to-try / wishlist) tab: a grid of the user's `status='todo'`
   records. Mirrors LibraryView's card grid + search, but is locked to
   todo items (LibraryView is now tasted-only). Tapping a card routes to
   /taste/[id]. Loading + empty states.
   ============================================================ */

import { useCallback, useMemo, useState } from 'react'
import { ActivityIndicator, RefreshControl, ScrollView, View, useWindowDimensions } from 'react-native'
import * as ExpoRouter from 'expo-router'
import { colors, space, Text } from '@/theme'
import { searchTastes } from '@yon/shared'
import { FoodCard, Icon, Input } from '@/components/ds'
import { useI18n } from '@/providers/I18nProvider'
import { useRefreshableTastes } from '@/app/(tabs)/_useTastes'

export default function TodoView() {
  const { t, formatMoney } = useI18n()
  const router = ExpoRouter.useRouter()
  const { width } = useWindowDimensions()
  const isWide = width >= 768

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
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 40 }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={colors.ink900}
          colors={[colors.ink900]}
        />
      }
    >
      {/* header */}
      <View style={{ gap: space[3] }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[2] }}>
          <Text style={{ fontWeight: '700', fontSize: 28 }}>
            {t('nav_todo')}
          </Text>
          <Text style={{ color: colors.colorMuted, fontSize: 13 }}>
            {t('count_logged', { n: items.filter((it) => (it.status ?? 'tasted') === 'todo').length })}
          </Text>
        </View>

        {/* search box */}
        <View style={{ position: 'relative', justifyContent: 'center' }}>
          <View style={{ position: 'absolute', left: 12, zIndex: 1 }}>
            <Icon name="search" size={18} color="#857a82" />
          </View>
          <Input
            value={query}
            onChangeText={setQuery}
            placeholder={t('search_log')}
            accessibilityLabel={t('search_log')}
            style={{ paddingLeft: 38 }}
          />
        </View>
      </View>

      {/* grid */}
      {loading ? (
        <View style={{ alignItems: 'center', paddingVertical: 48 }}>
          <ActivityIndicator color={colors.ink900} />
        </View>
      ) : shown.length === 0 ? (
        <View style={{ alignItems: 'center', paddingVertical: 48, gap: space[2] }}>
          <Icon name="bookmark" size={40} color={colors.ink300} />
          <Text style={{ color: colors.colorMuted }}>{t('nothing_here')}</Text>
        </View>
      ) : (
        <View
          style={{
            flexDirection: isWide ? 'row' : 'column',
            flexWrap: isWide ? 'wrap' : 'nowrap',
            gap: space[3],
          }}
        >
          {shown.map((it) => (
            <View key={it.id} style={isWide ? { width: '48%' } : undefined}>
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
