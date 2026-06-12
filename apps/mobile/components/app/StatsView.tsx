/* ============================================================
   YUMMY OR NOT -- StatsView (plain RN + theme, no Tamagui)
   RN port of the web StatsView: three verdict tiles, a money-saved
   card, and a verdict-breakdown bar chart.

   Loads stats from the API (getStats -> Stats); falls back to counting
   the passed-in `items` while the fetch resolves so the screen never
   renders empty.
   ============================================================ */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native'
import { useRouter } from 'expo-router'
import { getStats, type Stats, type Taste } from '@yon/shared'

import { Card, Icon } from '@/components/ds'
import { colors, space, radius, Text, textBase } from '@/theme'
import { useI18n } from '@/providers/I18nProvider'
import AnimatedNumber from '@/components/app/AnimatedNumber'

interface Props {
  items: Taste[]
  onRefresh?: () => Promise<void> | void
}

// Sentinel injected into the saved_amt translation template so we can split
// the sentence at the {amt} boundary. Plain ASCII so the source file stays
// text and git diffs work normally.
const SPLIT_MARKER = '__AMT_SPLIT__'

interface SavedAmountRowProps {
  t: (key: string, vars?: Record<string, string | number>) => string
  /** Characters before the digits in the formatted money string (e.g. "$", "¥"). */
  symbolPrefix: string
  /** Characters after the digits in the formatted money string (e.g. "€", ""). */
  symbolSuffix: string
  savedNumeric: number
}

function SavedAmountRow({ t, symbolPrefix, symbolSuffix, savedNumeric }: SavedAmountRowProps) {
  // Inject the sentinel so we can split the translated sentence into the
  // part before {amt} and the part after {amt}.
  const template = t('saved_amt', { amt: SPLIT_MARKER })
  const [sentencePre, sentencePost] = template.split(SPLIT_MARKER)
  const decimals = Number.isInteger(savedNumeric) ? 0 : 2

  // Rendering order: sentence-prefix . symbol-prefix . animated-number .
  //                  symbol-suffix . sentence-suffix
  // Handles both "$3 saved" (en) and "xia Y3" (zh) as well as
  // hypothetical suffix-symbol locales like "3E ahorrados".
  return (
    <View style={styles.savedAmtRow}>
      {sentencePre ? (
        <Text style={styles.savedAmtText}>{sentencePre}</Text>
      ) : null}
      {symbolPrefix ? (
        <Text style={styles.savedAmtText} testID="saved-currency-symbol">
          {symbolPrefix}
        </Text>
      ) : null}
      <AnimatedNumber
        value={savedNumeric}
        decimals={decimals}
        style={[textBase, { color: colors.ink900, fontWeight: '700', fontSize: 24 }]}
        testID="saved-animated-number"
      />
      {symbolSuffix ? (
        <Text style={styles.savedAmtText} testID="saved-currency-symbol">
          {symbolSuffix}
        </Text>
      ) : null}
      {sentencePost ? (
        <Text style={styles.savedAmtText}>{sentencePost}</Text>
      ) : null}
    </View>
  )
}

export default function StatsView({ items, onRefresh: refreshItems }: Props) {
  const { t, formatMoney } = useI18n()
  const router = useRouter()
  const [stats, setStats] = useState<Stats | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const mounted = useRef(false)

  const loadStats = useCallback(async (): Promise<Stats | null> => {
    try {
      return await getStats()
    } catch {
      // Keep the local item-count fallback visible when stats cannot load.
      return null
    }
  }, [])

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  useEffect(() => {
    let active = true
    void loadStats().then((s) => {
      if (active && s) setStats(s)
    })
    return () => {
      active = false
    }
  }, [loadStats, items.length])

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    try {
      await refreshItems?.()
      const s = await loadStats()
      if (mounted.current && s) setStats(s)
    } finally {
      if (mounted.current) setRefreshing(false)
    }
  }, [loadStats, refreshItems])

  // Client-side fallback: only count tasted items (todos have no verdict)
  const tastedItems = items.filter((it) => (it.status ?? 'tasted') === 'tasted')
  const count = (v: 'yum' | 'meh' | 'nah') =>
    stats ? stats[v] : tastedItems.filter((it) => it.verdict === v).length

  const total = stats?.total ?? tastedItems.length
  const rawSaved = stats?.savedAmount != null ? parseFloat(stats.savedAmount.replace(/[^0-9.]/g, '')) : 0
  const savedNumeric = Number.isFinite(rawSaved) ? rawSaved : 0
  // Route through formatMoney so the symbol honours the active locale.
  // Split the formatted string at the numeric boundary to isolate the symbol,
  // which may appear as a prefix ("$3") or suffix ("3E").
  const formattedSaved = formatMoney(savedNumeric)
  const numericMatch = formattedSaved.match(/[\d.,]+/)
  const numericToken = numericMatch ? numericMatch[0] : ''
  const numericIndex = numericToken ? formattedSaved.indexOf(numericToken) : -1
  // symbolPrefix: non-digit characters before the number (e.g. "$", "Y").
  // symbolSuffix: non-digit characters after the number (e.g. "E", "").
  const symbolPrefix = numericIndex > 0 ? formattedSaved.slice(0, numericIndex) : ''
  const symbolSuffix = numericIndex >= 0 ? formattedSaved.slice(numericIndex + numericToken.length) : formattedSaved

  const openVerdict = useCallback(
    (verdict: 'yum' | 'meh' | 'nah') => {
      router.push({ pathname: '/(tabs)', params: { verdict } })
    },
    [router],
  )

  const tile = (label: string, value: number, color: string, verdict: 'yum' | 'meh' | 'nah') => (
    <Pressable
      accessibilityRole="button"
      onPress={() => openVerdict(verdict)}
      style={{ flex: 1 }}
    >
      <View style={[styles.tile, { backgroundColor: color }]}>
        <AnimatedNumber
          value={value}
          style={[textBase, { color: '#fff', fontWeight: '700', fontSize: 48, lineHeight: 48 }]}
        />
        <Text style={styles.tileLabel}>{label}</Text>
      </View>
    </Pressable>
  )

  const bar = (label: string, verdict: 'yum' | 'meh' | 'nah', color: string) => {
    const n = count(verdict)
    const pct = total > 0 ? (n / total) * 100 : 0
    return (
      <View style={styles.barRow}>
        <View style={styles.barHeader}>
          <Text style={styles.barLabel}>{label}</Text>
          <AnimatedNumber
            value={n}
            style={[textBase, { color: colors.ink900, fontWeight: '600' }]}
          />
        </View>
        <View style={styles.barTrack}>
          <View style={[styles.barFill, { width: `${pct}%` as `${number}%`, backgroundColor: color }]} />
        </View>
      </View>
    )
  }

  return (
    <ScrollView
      testID="stats-scroll"
      style={styles.scroll}
      contentContainerStyle={styles.container}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor="#191017"
          colors={['#191017']}
        />
      }
    >
      {/* page heading */}
      <Text style={styles.heading}>{t('stats_title')}</Text>

      {/* verdict tiles */}
      <View style={styles.tileRow}>
        {tile(t('yum'), count('yum'), colors.verdictYum, 'yum')}
        {tile(t('meh'), count('meh'), colors.verdictMeh, 'meh')}
        {tile(t('nah'), count('nah'), colors.verdictNah, 'nah')}
      </View>

      {/* saved card */}
      <Card
        padded
        style={{ marginTop: space[4] }}
      >
        <View style={styles.savedRow}>
          <Icon name="coin" size={36} color="#ff5ca8" />
          <View>
            {/* Split the translated template at the {amt} position so only
                the numeric portion participates in the rolling animation.
                The currency symbol stays as static sibling text outside
                AnimatedNumber -- it must never roll. */}
            <SavedAmountRow
              t={t}
              symbolPrefix={symbolPrefix}
              symbolSuffix={symbolSuffix}
              savedNumeric={savedNumeric}
            />
            <Text style={styles.savedSub}>{t('saved_sub')}</Text>
          </View>
        </View>
      </Card>

      {/* breakdown bars */}
      <Card padded style={{ marginTop: space[6], maxWidth: 720 }}>
        <Text style={styles.kicker}>{t('verdict_breakdown')}</Text>
        <View style={{ marginTop: space[4] }}>
          {bar(t('yum_buy_again'), 'yum', colors.verdictYum)}
          {bar(t('meh_maybe'), 'meh', colors.verdictMeh)}
          {bar(t('nah_skip'), 'nah', colors.verdictNah)}
        </View>
      </Card>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    backgroundColor: colors.background,
  },
  container: {
    padding: 20,
  },
  heading: {
    color: colors.ink900,
    fontWeight: '700',
    fontSize: 40,
    lineHeight: 40,
  },
  kicker: {
    color: colors.ink400,
    fontSize: 11,
    letterSpacing: 1.32,
    textTransform: 'uppercase',
  },
  // verdict tiles
  tileRow: {
    flexDirection: 'row',
    gap: space[4],
    marginTop: 22,
    maxWidth: 720,
  },
  tile: {
    paddingVertical: 22,
    paddingHorizontal: 18,
    alignItems: 'center',
    borderWidth: 3,
    borderColor: colors.ink900,
    borderRadius: radius.lg,
    shadowColor: colors.ink900,
    shadowOffset: { width: 5, height: 5 },
    shadowOpacity: 1,
    shadowRadius: 0,
  },
  tileLabel: {
    color: '#fff',
    fontSize: 10,
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    marginTop: space[2],
  },
  // saved card
  savedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  savedAmtRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    flexWrap: 'wrap',
  },
  savedAmtText: {
    color: colors.ink900,
    fontWeight: '700',
    fontSize: 24,
  },
  savedSub: {
    color: colors.ink500,
    fontSize: 14,
  },
  // breakdown bars
  barRow: {
    marginBottom: space[4],
  },
  barHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: space[2],
  },
  barLabel: {
    color: colors.ink900,
    fontWeight: '600',
  },
  barTrack: {
    height: 22,
    backgroundColor: colors.white,
    borderWidth: 3,
    borderColor: colors.ink900,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
  },
})
