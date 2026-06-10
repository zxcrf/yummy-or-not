/* ============================================================
   YUMMY OR NOT -- StatsView (Tamagui / React Native + RN Web)
   RN port of the web StatsView: three verdict tiles, a money-saved
   card, and a verdict-breakdown bar chart.

   Loads stats from the API (getStats -> Stats); falls back to counting
   the passed-in `items` while the fetch resolves so the screen never
   renders empty.
   ============================================================ */

import { useCallback, useEffect, useRef, useState } from 'react'
import { RefreshControl } from 'react-native'
import { type GetProps, ScrollView, Text, View } from 'tamagui'
import { getStats, type Stats, type Taste } from '@yon/shared'

import { Card, Icon } from '@/components/ds'
import { useI18n } from '@/providers/I18nProvider'
import AnimatedNumber from '@/components/app/AnimatedNumber'

interface Props {
  items: Taste[]
  onRefresh?: () => Promise<void> | void
}

const KICKER = {
  color: '$ink400',
  fontSize: 11,
  letterSpacing: 1.32,
  textTransform: 'uppercase',
} as const

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
    <View flexDirection="row" alignItems="baseline" flexWrap="wrap">
      {sentencePre ? (
        <Text color="$ink900" fontWeight="700" fontSize={24}>
          {sentencePre}
        </Text>
      ) : null}
      {symbolPrefix ? (
        <Text color="$ink900" fontWeight="700" fontSize={24} testID="saved-currency-symbol">
          {symbolPrefix}
        </Text>
      ) : null}
      <AnimatedNumber
        value={savedNumeric}
        decimals={decimals}
        color="$ink900"
        fontWeight="700"
        fontSize={24}
        testID="saved-animated-number"
      />
      {symbolSuffix ? (
        <Text color="$ink900" fontWeight="700" fontSize={24} testID="saved-currency-symbol">
          {symbolSuffix}
        </Text>
      ) : null}
      {sentencePost ? (
        <Text color="$ink900" fontWeight="700" fontSize={24}>
          {sentencePost}
        </Text>
      ) : null}
    </View>
  )
}

export default function StatsView({ items, onRefresh: refreshItems }: Props) {
  const { t, formatMoney } = useI18n()
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

  const count = (v: 'yum' | 'meh' | 'nah') =>
    stats ? stats[v] : items.filter((it) => it.verdict === v).length

  const total = stats?.total ?? items.length
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

  type Color = GetProps<typeof View>['backgroundColor']

  const tile = (label: string, value: number, color: Color) => (
    <View
      flex={1}
      paddingVertical={22}
      paddingHorizontal={18}
      alignItems="center"
      borderWidth={3}
      borderColor="$ink900"
      borderRadius="$lg"
      backgroundColor={color}
      shadowColor="$ink900"
      shadowOffset={{ width: 5, height: 5 }}
      shadowOpacity={1}
      shadowRadius={0}
    >
      <AnimatedNumber
        value={value}
        color="#fff"
        fontWeight="700"
        fontSize={48}
        lineHeight={48}
      />
      <Text
        color="#fff"
        fontSize={10}
        letterSpacing={1.1}
        textTransform="uppercase"
        marginTop="$2"
      >
        {label}
      </Text>
    </View>
  )

  const bar = (label: string, verdict: 'yum' | 'meh' | 'nah', color: Color) => {
    const n = count(verdict)
    const pct = total > 0 ? (n / total) * 100 : 0
    return (
      <View marginBottom="$4">
        <View flexDirection="row" justifyContent="space-between" marginBottom="$2">
          <Text color="$ink900" fontWeight="600">
            {label}
          </Text>
          <AnimatedNumber value={n} color="$ink900" fontWeight="600" />
        </View>
        <View
          height={22}
          backgroundColor="$white"
          borderWidth={3}
          borderColor="$ink900"
          borderRadius="$pill"
          overflow="hidden"
        >
          <View width={`${pct}%`} height="100%" backgroundColor={color} />
        </View>
      </View>
    )
  }

  return (
    <ScrollView
      flex={1}
      backgroundColor="$background"
      contentContainerStyle={{ padding: 20 }}
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
      <Text color="$ink900" fontWeight="700" fontSize={40} lineHeight={40}>
        {t('stats_title')}
      </Text>

      {/* verdict tiles */}
      <View flexDirection="row" gap="$4" marginTop={22} maxWidth={720}>
        {tile(t('yum'), count('yum'), '$verdictYum')}
        {tile(t('meh'), count('meh'), '$verdictMeh')}
        {tile(t('nah'), count('nah'), '$verdictNah')}
      </View>

      {/* saved card */}
      <Card
        padded
        marginTop="$4"
        maxWidth={720}
        flexDirection="row"
        alignItems="center"
        gap={14}
      >
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
          <Text color="$ink500" fontSize={14}>
            {t('saved_sub')}
          </Text>
        </View>
      </Card>

      {/* breakdown bars */}
      <Card padded marginTop="$6" maxWidth={720}>
        <Text {...KICKER}>{t('verdict_breakdown')}</Text>
        <View marginTop="$4">
          {bar(t('yum_buy_again'), 'yum', '$verdictYum')}
          {bar(t('meh_maybe'), 'meh', '$verdictMeh')}
          {bar(t('nah_skip'), 'nah', '$verdictNah')}
        </View>
      </Card>
    </ScrollView>
  )
}
