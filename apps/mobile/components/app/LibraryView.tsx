/* ============================================================
   YUMMY OR NOT — LibraryView (plain RN + theme)
   The single 口味 surface. Two modes share one search box:
   - browse (no query): a grid of tasted FoodCards, filtered by the
     verdict + tag chips and sorted "Recent" (newest first) or "Nearby"
     (by distance, opt-in). This is the "what have I eaten?" library.
   - recall (query present): delegates to <RecallResults> for the
     "before you spend" answer — top verdict card, repurchase warning,
     and other matches. This replaces the old separate Recall tab.
   todo (想吃) records never appear here; they live in the To-Try tab.
   Tapping a card routes to /taste/[id].
   ============================================================ */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, RefreshControl, ScrollView, View, useWindowDimensions } from 'react-native'
import * as ExpoRouter from 'expo-router'
import { colors, space, Text } from '@/theme'
import { formatDistance } from '@yon/shared'
import { FoodCard, Icon, Input, Tag } from '@/components/ds'
import { useI18n } from '@/providers/I18nProvider'
import { useAuth } from '@/providers/AuthProvider'
import { filterTastesByTaster, useRefreshableTastes } from '@/app/(tabs)/_useTastes'
import { useActiveTaster } from '@/app/(tabs)/_useActiveTaster'
import { useTasters } from '@/app/(tabs)/_useTasters'
import { useUserCoords, sortByNearest } from '@/app/(tabs)/_useUserCoords'
import { useTags } from '@/app/(tabs)/_useTags'
import { RecallResults } from '@/components/app/RecallResults'

type VerdictFilter = 'yum' | 'meh' | 'nah'
type SortMode = 'recent' | 'nearby'

/** Returns the numeric ms timestamp of the last user activity on a taste.
 *  Mirrors the API's lastActivityMs = max(createdAt, newest purchase.createdAt).
 *  Uses numeric Date.getTime() to match the API exactly, avoiding edge-cases
 *  with ISO strings that have offsets or missing milliseconds fields. */
export function lastActivityMs(t: { createdAt?: string | null; purchases: Array<{ createdAt?: string | null }> }): number {
  const base = t.createdAt ? new Date(t.createdAt).getTime() : 0
  const latestPurchase = t.purchases[0]?.createdAt ? new Date(t.purchases[0].createdAt).getTime() : 0
  return Math.max(base, latestPurchase)
}

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

  const { user } = useAuth()
  const { items: allItems, loading, refresh } = useRefreshableTastes()
  const { tags } = useTags()
  // S3b: scope the list to the active persona. The shared cache holds every
  // persona's records; switching the TasterSwitcher chip must re-filter the
  // list below (not just attribute new records). null = self default.
  const activeTaster = useActiveTaster()
  const { tasters } = useTasters()
  const selfTasterId = useMemo(
    () => tasters.find((ts) => ts.isSelf)?.id ?? null,
    [tasters],
  )
  const items = useMemo(
    () => filterTastesByTaster(allItems, activeTaster, selfTasterId),
    [allItems, activeTaster, selfTasterId],
  )
  const [refreshing, setRefreshing] = useState(false)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<string>('All')
  const [sortMode, setSortMode] = useState<SortMode>('recent')
  const routeVerdict = useMemo(() => normalizeVerdictParam(params.verdict), [params.verdict])
  const [verdictFilter, setVerdictFilter] = useState<VerdictFilter | null>(routeVerdict)

  // Locate only when the user opts into the Nearby sort AND has location on.
  const nearbyActive = sortMode === 'nearby' && (user?.locationEnabled ?? false)
  const coords = useUserCoords(nearbyActive)

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

  // The tasted-only pool after the tag + verdict chips. Both modes search/sort
  // this same set, so a chip narrows the recall results too.
  const pool = useMemo(() => {
    const tasted = items.filter((it) => (it.status ?? 'tasted') === 'tasted')
    const filteredByTag =
      filter === 'All'
        ? tasted
        : tasted.filter(
            (it) =>
              it.tags.includes(filter) ||
              it.name.toLowerCase().includes(filter.toLowerCase()),
          )
    return verdictFilter == null
      ? filteredByTag
      : filteredByTag.filter((it) => it.verdict === verdictFilter)
  }, [items, filter, verdictFilter])

  // searchTastes returns [] for empty/1-char queries; treat those as browse.
  const isSearching = !!query && query.trim().length > 1

  // Browse rows: Nearby (distance asc, no-coords last) once we have a fix,
  // otherwise Recent (newest first) — so picking Nearby before/without a
  // location fix degrades to a sensible order instead of raw API order.
  const rows = useMemo(() => {
    if (sortMode === 'nearby' && coords) return sortByNearest(pool, coords)
    return [...pool]
      .sort((a, b) => {
        const diff = lastActivityMs(b) - lastActivityMs(a)
        if (diff !== 0) return diff
        // Tiebreak: createdAt desc (mirrors API's ORDER BY created_at DESC)
        return (b.createdAt ?? '').localeCompare(a.createdAt ?? '')
      })
      .map((item) => ({ item, distance: null as number | null }))
  }, [pool, sortMode, coords])

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
        <Text style={{ fontWeight: '700', fontSize: 28 }}>
          {t('my_tastes')}
        </Text>

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

      {/* sort toggle — browse mode only (recall results are ranked by relevance) */}
      {!isSearching ? (
        <View style={{ flexDirection: 'row', gap: space[2] }}>
          <Tag active={sortMode === 'recent'} onPress={() => setSortMode('recent')}>
            {t('sort_recent')}
          </Tag>
          <Tag active={sortMode === 'nearby'} onPress={() => setSortMode('nearby')}>
            {t('sort_nearby')}
          </Tag>
        </View>
      ) : null}

      {/* body */}
      {isSearching ? (
        <RecallResults pool={pool} query={query} />
      ) : loading ? (
        <View style={{ alignItems: 'center', paddingVertical: 48 }}>
          <ActivityIndicator color={colors.ink900} />
        </View>
      ) : rows.length === 0 ? (
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
          {rows.map(({ item: it, distance }) => (
            <View key={it.id} style={isWide ? { width: '48%' } : undefined}>
              <FoodCard
                imageThumb={it.imageThumb || undefined}
                image={it.image || undefined}
                imageKey={it.imageKey || undefined}
                name={it.name}
                place={it.place}
                distanceLabel={distance != null ? formatDistance(distance) : undefined}
                price={formatMoney(it.price)}
                status={it.status}
                verdict={it.verdict}
                mediaType={it.mediaType}
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
