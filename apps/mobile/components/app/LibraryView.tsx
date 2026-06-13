/* ============================================================
   YUMMY OR NOT — LibraryView (plain RN + theme)
   Browse logged tastes: search by name/place/notes (ranked), filter
   chips from the user's tag candidate set, and a grid/list of FoodCards.
   Loading + empty states. Tapping a card routes to /taste/[id].
   ============================================================ */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, RefreshControl, ScrollView, View, useWindowDimensions } from 'react-native'
import * as ExpoRouter from 'expo-router'
import { colors, space, Text } from '@/theme'
import { searchTastes } from '@yon/shared'
import { FoodCard, Icon, Input, Tag } from '@/components/ds'
import { useI18n } from '@/providers/I18nProvider'
import { useRefreshableTastes } from '@/app/(tabs)/_useTastes'
import { useTags } from '@/app/(tabs)/_useTags'

type VerdictFilter = 'yum' | 'meh' | 'nah'

function normalizeVerdictParam(verdict: string | string[] | undefined): VerdictFilter | null {
  const value = Array.isArray(verdict) ? verdict[0] : verdict
  return value === 'yum' || value === 'meh' || value === 'nah' ? value : null
}

export default function LibraryView() {
  const { t, formatMoney } = useI18n()
  const router = ExpoRouter.useRouter()
  const params =
    typeof ExpoRouter.useLocalSearchParams === 'function'
      ? ExpoRouter.useLocalSearchParams<{ verdict?: string | string[] }>()
      : {}
  const { width } = useWindowDimensions()
  const isWide = width >= 768

  const { items, loading, refresh } = useRefreshableTastes()
  const { tags } = useTags()
  const [refreshing, setRefreshing] = useState(false)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<string>('All')
  const routeVerdict = useMemo(() => normalizeVerdictParam(params.verdict), [params.verdict])
  const [verdictFilter, setVerdictFilter] = useState<VerdictFilter | null>(routeVerdict)

  useEffect(() => {
    setVerdictFilter(routeVerdict)
  }, [routeVerdict])

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
    () => tags.map((tg) => tg.name),
    [tags],
  )

  const shown = useMemo(() => {
    // Library is tasted-only — todo records live in the dedicated 想吃 tab.
    const tasted = items.filter((it) => (it.status ?? 'tasted') === 'tasted')

    // Tag/name filter (pure boolean — no scoring needed).
    const filteredByTag =
      filter === 'All'
        ? tasted
        : tasted.filter(
            (it) =>
              it.tags.includes(filter) ||
              it.name.toLowerCase().includes(filter.toLowerCase()),
          )

    // Verdict filter.
    const filtered =
      verdictFilter == null
        ? filteredByTag
        : filteredByTag.filter((it) => it.verdict === verdictFilter)

    // Search: use scored searchTastes so notes are included and results are ranked.
    // When query is empty/too-short, searchTastes returns [] — fall back to full list.
    if (!query || query.trim().length <= 1) return filtered

    const results = searchTastes(filtered, query)
    return results.map((r) => r.item)
  }, [items, query, filter, verdictFilter])

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 40 }}
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
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
            {t('my_tastes')}
          </Text>
          <Text style={{ color: colors.colorMuted, fontSize: 13 }}>
            {t('count_logged', { n: items.length })}
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

      {/* filter chips — sourced from user's tag candidate set */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
        <Tag
          active={filter === 'All' && verdictFilter == null}
          onPress={() => {
            setFilter('All')
            if (verdictFilter != null) router.setParams({ verdict: undefined })
            setVerdictFilter(null)
          }}
        >
          {t('all')}
        </Tag>
        {(['yum', 'meh', 'nah'] as const).map((verdict) => (
          <Tag
            key={verdict}
            active={verdictFilter === verdict}
            onPress={() => {
              if (verdictFilter === verdict) {
                router.setParams({ verdict: undefined })
                setVerdictFilter(null)
                return
              }
              setVerdictFilter(verdict)
            }}
          >
            {t(verdict)}
          </Tag>
        ))}
        {filterChips.map((f) => (
          <Tag key={f} active={filter === f} onPress={() => setFilter(f)}>
            {f}
          </Tag>
        ))}
      </View>

      {/* grid */}
      {loading ? (
        <View style={{ alignItems: 'center', paddingVertical: 48 }}>
          <ActivityIndicator color={colors.ink900} />
        </View>
      ) : shown.length === 0 ? (
        <View style={{ alignItems: 'center', paddingVertical: 48, gap: space[2] }}>
          <Icon name="reciept" size={40} color={colors.ink300} />
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
                verdictLabel={it.verdict ? t('v_' + it.verdict) : undefined}
                onPress={() => router.push(`/taste/${it.id}`)}
              />
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  )
}
