/* ============================================================
   YUMMY OR NOT — StatsView (Tamagui / React Native + RN Web)
   RN port of the web StatsView: three verdict tiles, a money-saved
   card, and a verdict-breakdown bar chart.

   Loads stats from the API (getStats → Stats); falls back to counting
   the passed-in `items` while the fetch resolves so the screen never
   renders empty.
   ============================================================ */

import { useEffect, useState } from 'react'
import { type GetProps, ScrollView, Text, View } from 'tamagui'
import { getStats, type Stats, type Taste } from '@yon/shared'

import { Card, Icon } from '@/components/ds'
import { useI18n } from '@/providers/I18nProvider'

interface Props {
  items: Taste[]
}

const KICKER = {
  color: '$ink400',
  fontSize: 11,
  letterSpacing: 1.32,
  textTransform: 'uppercase',
} as const

export default function StatsView({ items }: Props) {
  const { t } = useI18n()
  const [stats, setStats] = useState<Stats | null>(null)

  useEffect(() => {
    let active = true
    getStats()
      .then((s) => {
        if (active) setStats(s)
      })
      .catch(() => null)
    return () => {
      active = false
    }
  }, [items.length])

  const count = (v: 'yum' | 'meh' | 'nah') =>
    stats ? stats[v] : items.filter((it) => it.verdict === v).length

  const total = stats?.total ?? items.length
  const savedAmount = stats?.savedAmount ?? '$0.00'

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
      <Text color="#fff" fontWeight="700" fontSize={48} lineHeight={48}>
        {value}
      </Text>
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
          <Text color="$ink900" fontWeight="600">
            {n}
          </Text>
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
    <ScrollView flex={1} backgroundColor="$background" contentContainerStyle={{ padding: 20 }}>
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
          <Text color="$ink900" fontWeight="700" fontSize={24}>
            {t('saved_amt', { amt: savedAmount })}
          </Text>
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
