/* ============================================================
   YUMMY OR NOT — LibraryView (plain RN + theme)
   The single 口味 surface. Two modes share one search box:
   - browse (no query): a grid of FoodCards, filtered by the
     verdict + tag chips and sorted "Recent" (newest first) or "Nearby"
     (by distance, opt-in). This is the "what have I eaten?" library.
   - recall (query present): delegates to <RecallResults> for the
     "before you spend" answer — top verdict card, repurchase warning,
     and other matches. This replaces the old separate Recall tab.
     In todo mode, search filters the todo grid directly (no RecallResults).
   viewMode dropdown in the title switches between tasted and todo.
   Tapping a card routes to /taste/[id].
   ============================================================ */

import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, TouchableOpacity, View, useWindowDimensions } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as ExpoRouter from 'expo-router'
import { colors, space, Text } from '@/theme'
import { formatDistance } from '@yon/shared'
import { FoodCard, Icon, Input, Tag } from '@/components/ds'
import { PageHeader } from '@/components/app/PageHeader'
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
type ViewMode = 'tasted' | 'todo'

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

interface LibraryViewProps {
  /** Pinned to the top-right of the page header (the taster avatar). */
  headerRight?: ReactNode
}

export default function LibraryView({ headerRight }: LibraryViewProps = {}) {
  const { t, formatMoney } = useI18n()
  const router = ExpoRouter.useRouter()
  const insets = useSafeAreaInsets()
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
  const [viewMode, setViewMode] = useState<ViewMode>('tasted')
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [filterSheetOpen, setFilterSheetOpen] = useState(false)
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

  // Todo count: items in the current taster scope that are status==='todo'.
  const todoCount = useMemo(
    () => items.filter((it) => (it.status ?? 'tasted') === 'todo').length,
    [items],
  )

  // The pool after the tag + verdict chips. In tasted mode: tasted items only.
  // In todo mode: todo items only (verdict filter hidden/cleared).
  const pool = useMemo(() => {
    if (viewMode === 'todo') {
      return items.filter((it) => (it.status ?? 'tasted') === 'todo')
    }
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
  }, [items, filter, verdictFilter, viewMode])

  // searchTastes returns [] for empty/1-char queries; treat those as browse.
  const isSearching = !!query && query.trim().length > 1

  // In todo mode, search filters the todo grid by name — RecallResults is
  // tuned for tasted/recall UX and must not appear in todo mode.
  const todoSearchPool = useMemo(() => {
    if (!isSearching || viewMode !== 'todo') return pool
    const q = query.trim().toLowerCase()
    return pool.filter((it) => it.name.toLowerCase().includes(q))
  }, [pool, isSearching, viewMode, query])

  // Browse rows: Nearby (distance asc, no-coords last) once we have a fix,
  // otherwise Recent (newest first) — so picking Nearby before/without a
  // location fix degrades to a sensible order instead of raw API order.
  const rows = useMemo(() => {
    const activePool = viewMode === 'todo' ? todoSearchPool : pool
    if (sortMode === 'nearby' && coords) return sortByNearest(activePool, coords)
    return [...activePool]
      .sort((a, b) => {
        const diff = lastActivityMs(b) - lastActivityMs(a)
        if (diff !== 0) return diff
        // Tiebreak: createdAt desc (mirrors API's ORDER BY created_at DESC)
        return (b.createdAt ?? '').localeCompare(a.createdAt ?? '')
      })
      .map((item) => ({ item, distance: null as number | null }))
  }, [pool, todoSearchPool, viewMode, sortMode, coords])

  // Dropdown title label for the current viewMode.
  // Use my_tastes ('我的口味') for tasted mode — the screen identity label.
  const titleLabel =
    viewMode === 'tasted' ? t('my_tastes') : t('nav_todo')

  return (
    <View style={{ flex: 1 }}>
      {/* ── Top bar: CENTERED title-dropdown + top-right avatar (headerRight) ── */}
      <PageHeader
        title={
          <TouchableOpacity
            testID="title-dropdown"
            onPress={() => setDropdownOpen((o) => !o)}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
            activeOpacity={0.7}
          >
            <Text style={{ fontWeight: '700', fontSize: 28 }}>{titleLabel}</Text>
            <Text style={{ fontWeight: '700', fontSize: 20, color: colors.ink500 }}>▾</Text>
          </TouchableOpacity>
        }
        right={headerRight}
      />

      {/* ── Non-scrollable search box ── */}
      <View style={{ paddingHorizontal: 16, paddingTop: 8, gap: space[3] }}>
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

      {/* ── Dropdown: transparent full-screen backdrop + floating menu ──────
          Rendered as siblings after the header so the menu overlays the
          ScrollView but stays in the same test-renderer tree (no Modal portal).
          The backdrop catches outside-taps on all platforms. */}
      {dropdownOpen && (
        <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
          {/* Transparent backdrop — catches taps outside the menu */}
          <Pressable
            testID="dropdown-backdrop"
            style={StyleSheet.absoluteFill}
            onPress={() => setDropdownOpen(false)}
          />
          {/* Floating menu — dropped from the centered title (just below the bar).
              alignSelf:center keeps it under the now-centered title; marginTop
              clears the ~52px header bar. */}
          <View
            testID="title-dropdown-menu"
            style={{
              alignSelf: 'center',
              marginTop: 56,
              backgroundColor: colors.background,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: colors.ink100,
              minWidth: 180,
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 2 },
              shadowOpacity: 0.12,
              shadowRadius: 4,
              elevation: 4,
            }}
          >
            <Pressable
              testID="dropdown-item-tasted"
              onPress={() => {
                setViewMode('tasted')
                setDropdownOpen(false)
              }}
              style={{ flexDirection: 'row', alignItems: 'center', padding: 12, gap: 8 }}
            >
              {viewMode === 'tasted' && (
                <Text style={{ color: colors.ink900 }}>✓</Text>
              )}
              <Text style={{ color: colors.ink900 }}>{t('my_tastes')}</Text>
            </Pressable>
            <Pressable
              testID="dropdown-item-todo"
              onPress={() => {
                setViewMode('todo')
                setDropdownOpen(false)
              }}
              style={{ flexDirection: 'row', alignItems: 'center', padding: 12, gap: 8 }}
            >
              {viewMode === 'todo' && (
                <Text style={{ color: colors.ink900 }}>✓</Text>
              )}
              <Text style={{ color: colors.ink900 }}>{t('nav_todo')}</Text>
              <Text style={{ color: colors.colorMuted }}>{todoCount}</Text>
            </Pressable>
          </View>
        </View>
      )}

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
        {/* ── Single-line filter-row ─────────────────────────────────────────
            Left:  verdict icon buttons (tasted mode only) + horizontal
                   scrolling category tag chips + ⌄ expand button
            Right: sort segment (Recent / Nearby), pinned, browse-only
            The outer View is NOT a ScrollView and must NOT flexWrap — one line.
            ──────────────────────────────────────────────────────────────────── */}
        <View
          testID="filter-row"
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: space[2],
            // No flexWrap — enforces single-line layout
          }}
        >
          {/* Verdict filtering lives in the ⌄ filter sheet (below), NOT inline:
              the inline 😋😐🙅 buttons crowded this single-line row and starved
              the category tag scroll of width (bug 2026-06-17). The tag scroll
              now owns the full row. */}

          {/* Horizontal scrolling category tag chips — fills remaining space */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ flex: 1 }}
            contentContainerStyle={{ gap: space[2], alignItems: 'center' }}
            keyboardShouldPersistTaps="handled"
          >
            <Tag
              active={filter === 'All' && verdictFilter == null}
              onPress={() => {
                setFilter('All')
                if (verdictFilter != null) {
                  router.setParams({ verdict: undefined })
                  setVerdictFilter(null)
                }
              }}
            >
              {t('all')}
            </Tag>
            {filterChips.map((f) => (
              <Tag key={f} active={filter === f} onPress={() => setFilter(f)}>
                {f}
              </Tag>
            ))}
          </ScrollView>

          {/* ⌄ expand button — opens filter sheet */}
          <TouchableOpacity
            testID="filter-expand-btn"
            onPress={() => setFilterSheetOpen(true)}
            style={styles.expandBtn}
            accessibilityLabel={t('filter_sheet_title')}
          >
            <Text style={{ fontSize: 16, color: colors.ink500 }}>⌄</Text>
          </TouchableOpacity>

          {/* Sort segment — pinned right, browse mode only */}
          {!isSearching && (
            <View testID="sort-segment" style={{ flexDirection: 'row', gap: 2 }}>
              <Tag active={sortMode === 'recent'} onPress={() => setSortMode('recent')}>
                {t('sort_recent')}
              </Tag>
              <Tag active={sortMode === 'nearby'} onPress={() => setSortMode('nearby')}>
                {t('sort_nearby')}
              </Tag>
            </View>
          )}
        </View>

        {/* body */}
        {isSearching && viewMode === 'tasted' ? (
          <RecallResults pool={pool} query={query} />
        ) : loading ? (
          <View style={{ alignItems: 'center', paddingVertical: 48 }}>
            <ActivityIndicator color={colors.ink900} />
          </View>
        ) : rows.length === 0 ? (
          viewMode === 'todo' ? (
            <View style={{ alignItems: 'center', paddingVertical: 48, gap: space[2] }}>
              <Icon name="bookmark" size={40} color={colors.ink300} />
              <Text style={{ color: colors.colorMuted }}>{t('nothing_here')}</Text>
            </View>
          ) : (
            <View style={{ alignItems: 'center', paddingVertical: 48, gap: space[2] }}>
              <Icon name="reciept" size={40} color={colors.ink300} />
              <Text style={{ color: colors.colorMuted }}>{t('nothing_here')}</Text>
            </View>
          )
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

      {/* ── Filter sheet — absoluteFill sibling (no Modal portal, matches plan-2 dropdown pattern) ── */}
      {filterSheetOpen && (
        <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
          {/* Transparent backdrop — catches taps outside the sheet */}
          <Pressable
            testID="filter-sheet-backdrop"
            style={StyleSheet.absoluteFill}
            onPress={() => setFilterSheetOpen(false)}
          />
          {/* Sheet panel — slides up from bottom */}
          <View
            testID="filter-sheet"
            style={[styles.filterSheet, { paddingBottom: insets.bottom + 16 }]}
          >
            {/* Sheet header */}
            <View style={styles.filterSheetHeader}>
              <Text style={styles.filterSheetTitle}>{t('filter_sheet_title')}</Text>
              <TouchableOpacity
                testID="filter-sheet-close"
                onPress={() => setFilterSheetOpen(false)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={{ fontSize: 18, color: colors.ink500 }}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* Verdict section — tasted mode only */}
            {viewMode === 'tasted' && (
              <View style={styles.filterSheetSection}>
                <Text style={styles.filterSheetSectionLabel}>{t('filter_taste')}</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
                  {(['yum', 'meh', 'nah'] as const).map((verdict) => {
                    const emoji = verdict === 'yum' ? '😋' : verdict === 'meh' ? '😐' : '🙅'
                    return (
                      <Tag
                        key={verdict}
                        active={verdictFilter === verdict}
                        onPress={() => {
                          if (verdictFilter === verdict) {
                            router.setParams({ verdict: undefined })
                            setVerdictFilter(null)
                          } else {
                            setVerdictFilter(verdict)
                          }
                        }}
                      >
                        {`${emoji} ${t(verdict)}`}
                      </Tag>
                    )
                  })}
                </View>
              </View>
            )}

            {/* Tags section */}
            <View style={styles.filterSheetSection}>
              <Text style={styles.filterSheetSectionLabel}>{t('filter_tags')}</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
                <Tag
                  active={filter === 'All' && verdictFilter == null}
                  onPress={() => setFilter('All')}
                >
                  {t('all')}
                </Tag>
                {filterChips.map((f) => (
                  <Tag key={f} active={filter === f} onPress={() => setFilter(f)}>
                    {f}
                  </Tag>
                ))}
              </View>
            </View>
          </View>
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  expandBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterSheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.backgroundStrong,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 16,
    paddingTop: 16,
    // paddingBottom is set dynamically (insets.bottom + 16) on the View itself
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 8,
  },
  filterSheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  filterSheetTitle: {
    fontWeight: '700',
    fontSize: 18,
  },
  filterSheetSection: {
    marginBottom: 16,
    gap: 8,
  },
  filterSheetSectionLabel: {
    fontWeight: '600',
    fontSize: 14,
    color: '#857a82',
    marginBottom: 4,
  },
})
