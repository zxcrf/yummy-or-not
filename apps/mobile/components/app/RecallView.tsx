/* ============================================================
   YUMMY OR NOT — RecallView (Tamagui / React Native)
   "Tasted it before?" search. Shows scored results from searchTastes:
   - top match → big verdict card (with warn styling if warnBeforeBuy and
     user.warningsEnabled)
   - additional matches → compact "Other matches" group
   - recently-recalled list when the box is empty
   - no-record empty state that links to Add
   ============================================================ */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Pressable, RefreshControl, useWindowDimensions } from 'react-native'
import { Image } from 'expo-image'
import { useRouter } from 'expo-router'
import * as Location from 'expo-location'
import { ScrollView, Text, View, XStack, YStack } from 'tamagui'
import { searchTastes, haversineMeters, formatDistance, type Taste, type Verdict } from '@yon/shared'
import { Button, Card, Icon, Input, Tag, VerdictStamp } from '@/components/ds'
import { useI18n } from '@/providers/I18nProvider'
import { useAuth } from '@/providers/AuthProvider'
import { useRefreshableTastes } from '@/app/(tabs)/_useTastes'

const NEARBY_TASTED_CAP = 5
const NEARBY_TODO_CAP = 3

const ACCENT_BG = {
  yum: '$verdictYum',
  meh: '$verdictMeh',
  nah: '$verdictNah',
} as const satisfies Record<Verdict, string>

const VERDICT_KEY: Record<Verdict, string> = {
  yum: 'loved_it',
  meh: 'soso',
  nah: 'skip_it',
}

const RECENT_CARD_MIN = 3
const RECENT_CARD_MAX = 8
const RECENT_CARD_BASE_OFFSET = 392
const RECENT_CARD_ROW_HEIGHT = 88

export function recentCardCount(windowHeight: number): number {
  if (windowHeight === Number.POSITIVE_INFINITY) {
    return RECENT_CARD_MAX
  }

  const safeHeight = Number.isFinite(windowHeight) ? Math.max(0, windowHeight) : 0
  const estimatedRows = Math.floor((safeHeight - RECENT_CARD_BASE_OFFSET) / RECENT_CARD_ROW_HEIGHT)

  return Math.max(RECENT_CARD_MIN, Math.min(RECENT_CARD_MAX, estimatedRows))
}

function RecallRow({
  item,
  onPress,
  flat,
  warnActive,
  distanceLabel,
  isTodo,
}: {
  item: Taste
  onPress: () => void
  flat?: boolean
  warnActive?: boolean
  distanceLabel?: string
  isTodo?: boolean
}) {
  const { t } = useI18n()
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={{ width: '100%' }}>
      <XStack
        cursor="pointer"
        alignItems="center"
        gap="$3"
        width="100%"
        backgroundColor={flat ? 'transparent' : '$white'}
        borderWidth={flat ? 0 : 3}
        borderColor={warnActive ? '$verdictNah2' : '$ink900'}
        borderRadius="$md"
        padding={flat ? 0 : 10}
        {...(flat
          ? {}
          : {
              shadowColor: warnActive ? '$verdictNah2' : '$ink900',
              shadowOffset: { width: 3, height: 3 },
              shadowOpacity: 1,
              shadowRadius: 0,
            })}
      >
        <View
          width={54}
          height={54}
          borderRadius="$sm"
          borderWidth={2}
          borderColor="$ink900"
          backgroundColor="$paper2"
          overflow="hidden"
          flexShrink={0}
        >
          {(item.imageThumb || item.image) ? (
            <Image
              source={{
                uri: item.imageThumb || item.image,
                ...(item.imageKey ? { cacheKey: `${item.imageKey}:thumb` } : {}),
              }}
              cachePolicy="disk"
              transition={150}
              style={{ width: '100%', height: '100%' }}
              contentFit="cover"
            />
          ) : null}
        </View>
        <YStack flex={1} minWidth={0}>
          <Text color="$ink900" fontWeight="700" fontSize={16}>
            {item.name}
          </Text>
          <Text color="$ink500" fontSize={13}>
            {item.place} · {item.date}
          </Text>
          {distanceLabel ? (
            <Text color="$ink400" fontSize={12}>{distanceLabel}</Text>
          ) : null}
        </YStack>
        {isTodo ? (
          <Tag testID="todo-badge">{t('todo_badge')}</Tag>
        ) : item.verdict != null ? (
          <VerdictStamp verdict={item.verdict} size="sm" label={t('v_' + item.verdict)} />
        ) : null}
      </XStack>
    </Pressable>
  )
}

export default function RecallView() {
  const { t } = useI18n()
  const router = useRouter()
  const { user } = useAuth()
  const { height } = useWindowDimensions()

  const { items, refresh } = useRefreshableTastes()
  const [q, setQ] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const visibleRecentItems = recentCardCount(height)

  // Nearby eaten — one-shot locate on mount when locationEnabled and no active query.
  const [userCoords, setUserCoords] = useState<{ lat: number; lng: number } | null>(null)

  useEffect(() => {
    if (!user?.locationEnabled) return
    let cancelled = false
    ;(async () => {
      try {
        const perm = await Location.requestForegroundPermissionsAsync()
        if (!perm.granted || cancelled) return
        const posPromise = Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
        let timer: ReturnType<typeof setTimeout> | undefined
        const timeout = new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('timeout')), 10_000)
        })
        try {
          const pos = await Promise.race([posPromise, timeout])
          if (!cancelled) setUserCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude })
        } finally {
          if (timer) clearTimeout(timer)
        }
      } catch {
        // Silent degrade — no coords, nearby group won't render
      }
    })()
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.locationEnabled])

  useEffect(() => {
    const id = setTimeout(() => setDebouncedQ(q), 250)
    return () => clearTimeout(id)
  }, [q])

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    try {
      await refresh()
    } finally {
      setRefreshing(false)
    }
  }, [refresh])

  // Nearby groups — items with coords sorted by distance ascending, split by status.
  // 想吃 (todo) cap 3, 吃过的 (tasted) cap 5. Both absent → neither group renders.
  const { nearbyTodo, nearbyTasted } = useMemo(() => {
    if (!userCoords) return { nearbyTodo: [], nearbyTasted: [] }
    const withDistance = items
      .filter((it) => it.lat != null && it.lng != null)
      .map((it) => ({
        item: it,
        distance: haversineMeters(userCoords.lat, userCoords.lng, it.lat!, it.lng!),
      }))
      .sort((a, b) => a.distance - b.distance)
    return {
      nearbyTodo: withDistance.filter((x) => (x.item.status ?? 'tasted') === 'todo').slice(0, NEARBY_TODO_CAP),
      nearbyTasted: withDistance.filter((x) => (x.item.status ?? 'tasted') === 'tasted').slice(0, NEARBY_TASTED_CAP),
    }
  }, [items, userCoords])

  // All scored results above threshold, ranked by score descending.
  const tastedItems = useMemo(
    () => items.filter((it) => (it.status ?? 'tasted') === 'tasted'),
    [items],
  )
  const results = useMemo(() => (debouncedQ ? searchTastes(tastedItems, debouncedQ) : []), [tastedItems, debouncedQ])

  const topMatch = results[0]?.item ?? null
  const otherMatches = results.slice(1).map((r) => r.item)

  // Todo hint: when searching, check if query hits the todo list
  const todoHints = useMemo(() => {
    if (!debouncedQ) return []
    const todoItems = items.filter((it) => (it.status ?? 'tasted') === 'todo')
    return searchTastes(todoItems, debouncedQ)
      .filter((r) => r.strength === 'exact' || r.strength === 'strong')
      .map((r) => r.item)
  }, [items, debouncedQ])

  // Warning styling applies only when the taste has the flag set and the user
  // has warnings enabled globally. Falls back to plain display if user is null
  // (not yet loaded) or warnings are disabled.
  const warningsOn = user?.warningsEnabled ?? false
  const topWarn = warningsOn && (topMatch?.warnBeforeBuy ?? false)

  return (
    <ScrollView
      flex={1}
      backgroundColor="$background"
      contentContainerStyle={{ padding: 16, gap: 24, paddingBottom: 40 }}
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
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
      <YStack gap="$2">
        <Text color="$color" fontWeight="700" fontSize={36} lineHeight={38}>
          {t('recall_title')}
        </Text>
        <Text color="$ink500" fontSize={17}>
          {t('recall_sub')}
        </Text>
        <View position="relative" justifyContent="center" marginTop="$2">
          <View position="absolute" left={14} zIndex={1}>
            <Icon name="search" size={22} color="#857a82" />
          </View>
          <Input
            value={q}
            onChangeText={setQ}
            placeholder={t('recall_placeholder')}
            accessibilityLabel={t('recall_placeholder')}
            style={{ fontSize: 18, paddingLeft: 46, paddingVertical: 16 }}
          />
        </View>
      </YStack>

      {/* results */}
      <YStack gap="$3">
        {!q ? (
          <YStack gap="$3">
            {/* 附近你想吃的 — todo + coords, cap 3 (shown first) */}
            {nearbyTodo.length > 0 ? (
              <YStack gap="$3">
                <Text
                  color="$ink400"
                  fontSize={10}
                  letterSpacing={1}
                  textTransform="uppercase"
                >
                  {t('nearby_todo')}
                </Text>
                {nearbyTodo.map(({ item: it, distance }) => (
                  <RecallRow
                    key={it.id}
                    item={it}
                    onPress={() => router.push(`/taste/${it.id}`)}
                    distanceLabel={formatDistance(distance)}
                    isTodo
                  />
                ))}
              </YStack>
            ) : null}
            {/* 附近吃过的 — tasted + coords, cap 5 */}
            {nearbyTasted.length > 0 ? (
              <YStack gap="$3">
                <Text
                  color="$ink400"
                  fontSize={10}
                  letterSpacing={1}
                  textTransform="uppercase"
                >
                  {t('nearby_eaten')}
                </Text>
                {nearbyTasted.map(({ item: it, distance }) => (
                  <RecallRow
                    key={it.id}
                    item={it}
                    onPress={() => router.push(`/taste/${it.id}`)}
                    distanceLabel={formatDistance(distance)}
                  />
                ))}
              </YStack>
            ) : null}
            <Text
              color="$ink400"
              fontSize={10}
              letterSpacing={1}
              textTransform="uppercase"
            >
              {t('recently_recalled')}
            </Text>
            {tastedItems.slice(0, visibleRecentItems).map((it) => (
              <RecallRow
                key={it.id}
                item={it}
                onPress={() => router.push(`/taste/${it.id}`)}
              />
            ))}
          </YStack>
        ) : topMatch ? (
          <YStack gap="$3">
            {/* top result — big verdict card */}
            <Card variant="raised">
              <YStack
                backgroundColor={topWarn ? '$verdictNah' : (topMatch.verdict ? ACCENT_BG[topMatch.verdict] : '$paper2')}
                paddingHorizontal={22}
                paddingTop={22}
                paddingBottom={20}
                borderBottomWidth={3}
                borderColor={topWarn ? '$verdictNah2' : '$ink900'}
              >
                {topWarn ? (
                  <>
                    <Text
                      color="$ink900"
                      fontSize={11}
                      letterSpacing={1.3}
                      textTransform="uppercase"
                      opacity={0.9}
                    >
                      {t('verdict_on_file')}
                    </Text>
                    <Text color="$ink900" fontWeight="700" fontSize={28} marginTop="$1">
                      {t('recall_warn_skip')}
                    </Text>
                  </>
                ) : topMatch.verdict != null ? (
                  <>
                    <Text
                      color="$ink900"
                      fontSize={11}
                      letterSpacing={1.3}
                      textTransform="uppercase"
                      opacity={0.9}
                    >
                      {t('verdict_on_file')}
                    </Text>
                    <Text color="$ink900" fontWeight="700" fontSize={46} marginTop="$1">
                      {t(VERDICT_KEY[topMatch.verdict])}
                    </Text>
                  </>
                ) : (
                  <Text color="$ink900" fontWeight="700" fontSize={28} marginTop="$1">
                    {t('todo_badge')}
                  </Text>
                )}
              </YStack>
              <View padding={18}>
                <RecallRow
                  item={topMatch}
                  onPress={() => router.push(`/taste/${topMatch.id}`)}
                  flat
                  warnActive={topWarn}
                />
              </View>
            </Card>

            {/* additional matches */}
            {otherMatches.length > 0 ? (
              <YStack gap="$2">
                <Text
                  color="$ink400"
                  fontSize={10}
                  letterSpacing={1}
                  textTransform="uppercase"
                >
                  {t('recall_other_matches')}
                </Text>
                {otherMatches.map((it) => {
                  const warnRow = warningsOn && it.warnBeforeBuy
                  return (
                    <RecallRow
                      key={it.id}
                      item={it}
                      onPress={() => router.push(`/taste/${it.id}`)}
                      warnActive={warnRow}
                    />
                  )
                })}
              </YStack>
            ) : null}

            {/* todo hint — "在你的想吃清单里" */}
            {todoHints.length > 0 ? (
              <YStack gap="$2">
                <Text
                  color="$ink400"
                  fontSize={10}
                  letterSpacing={1}
                  textTransform="uppercase"
                  testID="recall-in-todo-header"
                >
                  {t('recall_in_todo')}
                </Text>
                {todoHints.map((it) => (
                  <RecallRow
                    key={it.id}
                    item={it}
                    onPress={() => router.push(`/taste/${it.id}`)}
                    isTodo
                  />
                ))}
              </YStack>
            ) : null}
          </YStack>
        ) : (
          <Card padded>
            <YStack alignItems="center" gap="$2" paddingVertical={24}>
              <Icon name="info-box" size={40} color="#b8aeb4" />
              <Text color="$ink900" fontWeight="600" fontSize={18} textAlign="center">
                {t('no_record', { q: debouncedQ })}
              </Text>
              <Text color="$ink500" textAlign="center">
                {t('try_then_log')}
              </Text>
              <Button
                variant="primary"
                style={{ marginTop: 12 }}
                onPress={() => router.push('/add')}
                iconLeft={<Icon name="plus" size={18} color="#fff" />}
              >
                {t('log_it_now')}
              </Button>
            </YStack>
          </Card>
        )}
      </YStack>
    </ScrollView>
  )
}
