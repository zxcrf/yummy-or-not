/* ============================================================
   YUMMY OR NOT — RecallView (回忆 纵向时间轴)
   Flattens every tasted taste into a unified event stream:
     • kind='first'      → the taste's original createdAt
     • kind='repurchase' → each entry in taste.purchases[]
   Events are sorted desc by `at`, then bucketed under day
   headers (今天 / 昨天 / MM-DD).  Repurchase events carry a
   "再买" badge.  Tapping any row routes to /taste/[id].
   Active-taster filtering mirrors LibraryView: the shared cache
   holds all personas' records; only the active taster's records
   are shown (null = self default).
   ============================================================ */

import { useCallback, useMemo, useState } from 'react'
import { Pressable, RefreshControl, ScrollView, View } from 'react-native'
import { Image } from 'expo-image'
import { useRouter } from 'expo-router'
import type { Taste } from '@yon/shared'
import { colors, space, Text } from '@/theme'
import { useI18n } from '@/providers/I18nProvider'
import { filterTastesByTaster, useRefreshableTastes } from '@/app/(tabs)/_useTastes'
import { useActiveTaster } from '@/app/(tabs)/_useActiveTaster'
import { useTasters } from '@/app/(tabs)/_useTasters'

// ----------------------------------------------------------------
// Data model
// ----------------------------------------------------------------

interface RecallEvent {
  key: string
  tasteId: string
  name: string
  place: string
  price: string
  imageThumb: string
  imageKey: string
  verdict: Taste['verdict']
  kind: 'first' | 'repurchase'
  at: string // ISO string
}

/** Flatten one taste into its constituent timeline events. */
export function flattenTaste(taste: Taste): RecallEvent[] {
  // Only 'tasted' entries belong in the recall timeline.
  if ((taste.status ?? 'tasted') !== 'tasted') return []

  const base: RecallEvent = {
    key: `first-${taste.id}`,
    tasteId: taste.id,
    name: taste.name,
    place: taste.place ?? '',
    price: taste.price ?? '',
    imageThumb: taste.imageThumb ?? '',
    imageKey: taste.imageKey ?? '',
    verdict: taste.verdict,
    kind: 'first',
    at: taste.createdAt ?? '',
  }

  const repurchases: RecallEvent[] = (taste.purchases ?? []).map((p, i) => ({
    key: `repurchase-${taste.id}-${i}`,
    tasteId: taste.id,
    name: taste.name,
    place: p.place ?? taste.place ?? '',
    price: p.price ?? taste.price ?? '',
    imageThumb: taste.imageThumb ?? '',
    imageKey: taste.imageKey ?? '',
    verdict: taste.verdict,
    kind: 'repurchase',
    at: p.createdAt ?? '',
  }))

  return [base, ...repurchases]
}

// ----------------------------------------------------------------
// Date helpers
// ----------------------------------------------------------------

function isoToDateStr(iso: string): string {
  // Return YYYY-MM-DD in local time.
  const d = new Date(iso)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function todayStr(): string {
  return isoToDateStr(new Date().toISOString())
}

function yesterdayStr(): string {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return isoToDateStr(d.toISOString())
}

function timeLabel(iso: string): string {
  const d = new Date(iso)
  const h = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  return `${h}:${min}`
}

// ----------------------------------------------------------------
// Group structure
// ----------------------------------------------------------------

interface DayGroup {
  label: string
  events: RecallEvent[]
}

export function groupByDay(
  events: RecallEvent[],
  todayLabel: string,
  yesterdayLabel: string,
): DayGroup[] {
  const today = todayStr()
  const yesterday = yesterdayStr()

  const map = new Map<string, RecallEvent[]>()
  const order: string[] = []

  for (const ev of events) {
    const date = isoToDateStr(ev.at)
    if (!map.has(date)) {
      map.set(date, [])
      order.push(date)
    }
    map.get(date)!.push(ev)
  }

  return order.map((date) => {
    let label: string
    if (date === today) label = todayLabel
    else if (date === yesterday) label = yesterdayLabel
    else label = date.slice(5) // MM-DD
    return { label, events: map.get(date)! }
  })
}

// ----------------------------------------------------------------
// Anchor components — each is a named function component so that
// react-test-renderer creates exactly ONE fiber node for the component
// itself (with the data-* props on it), separate from the inner host
// View fiber which does NOT inherit those custom props.
// ----------------------------------------------------------------

/**
 * Single-fiber anchor for a timeline row.
 * test-renderer finds this component fiber by `data-taste-id` and calls
 * `onPress` on it.  The host View rendered inside is a separate fiber and
 * never has `data-taste-id` in its own props.
 */
interface RowAnchorProps {
  'data-taste-id': string
  onPress: () => void
  children: React.ReactNode
}
function RecallRowAnchor({ children, onPress }: RowAnchorProps) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: space[3],
        paddingVertical: space[2],
        opacity: pressed ? 0.7 : 1,
      })}
    >
      {children}
    </Pressable>
  )
}

/**
 * Single-fiber anchor for the repurchase badge.
 * test-renderer finds this component fiber by `data-badge === 'repurchase'`.
 * The inner host View is a child fiber and does NOT carry `data-badge`.
 */
interface BadgeProps {
  'data-badge': string
  children: React.ReactNode
}
function RepurchaseBadge({ children }: BadgeProps) {
  return (
    <View style={{ borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 }}>
      {/*
        Wrap in array so the Text fiber's props.children is an array,
        not a plain string — prevents `typeof n.props.children === 'string'`
        from matching the inner Text and double-counting the badge.
        The RepurchaseBadge component fiber itself has children=string and
        data-badge='repurchase', so it is the unique single match.
      */}
      <Text style={{ fontSize: 11, color: colors.accent, fontWeight: '600' }}>
        {[children]}
      </Text>
    </View>
  )
}

// ----------------------------------------------------------------
// Row component
// ----------------------------------------------------------------

// Width of the left rail column: dot (8px) + some padding on each side.
const RAIL_WIDTH = 28

interface RowProps {
  event: RecallEvent
  repurchaseLabel: string
  isLast: boolean
  onPress: () => void
}

function RecallRow({ event, repurchaseLabel, isLast, onPress }: RowProps) {
  const { formatMoney } = useI18n()
  const hasImage = !!(event.imageThumb || event.imageKey)

  return (
    <RecallRowAnchor data-taste-id={event.tasteId} onPress={onPress}>
      {/* ── left rail: dot + connector line ── */}
      <View
        style={{
          width: RAIL_WIDTH,
          alignItems: 'center',
          paddingTop: 4, // align dot with first line of content
        }}
      >
        {/* dot */}
        <View
          testID="recall-rail-dot"
          style={{
            width: 8,
            height: 8,
            borderRadius: 4,
            backgroundColor: colors.accent,
          }}
        />
        {/* connector line — hidden on the last event in a group */}
        {!isLast && (
          <View
            style={{
              flex: 1,
              width: 2,
              backgroundColor: colors.ink100,
              marginTop: 4,
              minHeight: 32,
            }}
          />
        )}
      </View>

      {/* ── time label ── */}
      <Text
        style={{
          fontSize: 11,
          color: colors.colorFaint,
          paddingTop: 5,
          width: 36,
        }}
      >
        {timeLabel(event.at)}
      </Text>

      {/* ── thumbnail ── */}
      <View
        style={{
          width: 48,
          height: 48,
          borderRadius: 8,
          backgroundColor: colors.ink100,
          overflow: 'hidden',
        }}
      >
        {hasImage && (
          <Image
            testID="recall-thumb"
            source={{
              uri: event.imageThumb,
              ...(event.imageKey ? { cacheKey: `${event.imageKey}:thumb` } : {}),
            }}
            cachePolicy="disk"
            transition={150}
            style={{ width: 48, height: 48 }}
            contentFit="cover"
          />
        )}
      </View>

      {/* ── content ── */}
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
          <Text
            numberOfLines={1}
            style={{ fontWeight: '600', fontSize: 14, color: colors.color, flexShrink: 1 }}
          >
            {event.name}
          </Text>
          {event.kind === 'repurchase' && (
            <RepurchaseBadge data-badge="repurchase">
              {repurchaseLabel}
            </RepurchaseBadge>
          )}
        </View>

        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: space[2],
            flexWrap: 'wrap',
          }}
        >
          {!!event.place && (
            <Text numberOfLines={1} style={{ fontSize: 12, color: colors.colorMuted, flexShrink: 1 }}>
              {event.place}
            </Text>
          )}
          {!!event.price && (
            <Text style={{ fontSize: 12, color: colors.colorMuted }}>
              {formatMoney(event.price)}
            </Text>
          )}
          {!!event.verdict && (
            <Text style={{ fontSize: 12, color: colors.colorFaint }}>{event.verdict}</Text>
          )}
        </View>
      </View>
    </RecallRowAnchor>
  )
}

// ----------------------------------------------------------------
// Main component
// ----------------------------------------------------------------

export default function RecallView() {
  const { t } = useI18n()
  const router = useRouter()
  const { items: allItems, loading: _loading, refresh } = useRefreshableTastes()
  const [refreshing, setRefreshing] = useState(false)

  // S3b: scope to the active persona, mirroring LibraryView.
  // The shared cache holds every persona's records; switching the
  // TasterSwitcher chip must re-filter here too.
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

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    try {
      await refresh()
    } finally {
      setRefreshing(false)
    }
  }, [refresh])

  const groups = useMemo(() => {
    // Flatten all tasted tastes into events, sort desc by at.
    const events = items
      .flatMap(flattenTaste)
      .filter((ev) => !!ev.at)
      .sort((a, b) => b.at.localeCompare(a.at))

    return groupByDay(events, t('recall_today'), t('recall_yesterday'))
  }, [items, t])

  const isEmpty = groups.length === 0

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
      keyboardDismissMode="on-drag"
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={colors.ink900}
          colors={[colors.ink900]}
        />
      }
    >
      {/* page title */}
      <Text style={{ fontWeight: '700', fontSize: 28, marginBottom: space[3] }}>
        {t('nav_recall')}
      </Text>

      {isEmpty ? (
        <View
          data-testid="recall-empty"
          style={{ alignItems: 'center', paddingVertical: 48 }}
        >
          <Text style={{ color: colors.colorMuted }}>{t('recall_empty')}</Text>
        </View>
      ) : (
        groups.map((group) => (
          <View key={group.label} style={{ marginBottom: space[3] }}>
            {/* day header */}
            <Text
              data-group={group.label}
              style={{
                fontWeight: '700',
                fontSize: 13,
                color: colors.colorMuted,
                marginBottom: space[2],
                marginTop: space[1],
              }}
            >
              {group.label}
            </Text>

            {/* rows with rail */}
            <View>
              {group.events.map((ev, idx) => (
                <RecallRow
                  key={ev.key}
                  event={ev}
                  repurchaseLabel={t('recall_repurchase_badge')}
                  isLast={idx === group.events.length - 1}
                  onPress={() => router.push(`/taste/${ev.tasteId}`)}
                />
              ))}
            </View>
          </View>
        ))
      )}
    </ScrollView>
  )
}
