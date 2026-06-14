/* ============================================================
   YUMMY OR NOT — FamilyFeedView (plain RN + theme, no Tamagui)

   Renders the shared family / member taste stream from
   GET /api/feed/family (getFamilyFeed). The server scopes visibility
   to 'shared' rows targeted to the viewer's family / members and
   returns the coarsened GeoFeedCard shape (name / verdict / thumb) —
   no precise coordinate or identity. Card layout mirrors the cell
   bottom-sheet in NearbyHeatView for visual parity.
   ============================================================ */

import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, View } from 'react-native'
import { Image } from 'expo-image'
import { getFamilyFeed, type GeoFeedCard } from '@yon/shared'

import { VerdictStamp } from '@/components/ds'
import { useI18n } from '@/providers/I18nProvider'
import { colors, space, radius, Text } from '@/theme'

// Known verdict literals — render a stamp only for these.
const VERDICTS = ['yum', 'meh', 'nah'] as const
type KnownVerdict = (typeof VERDICTS)[number]
function asVerdict(v: unknown): KnownVerdict | null {
  return typeof v === 'string' && (VERDICTS as readonly string[]).includes(v)
    ? (v as KnownVerdict)
    : null
}

export default function FamilyFeedView() {
  const { t } = useI18n()
  const [cards, setCards] = useState<GeoFeedCard[] | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    try {
      const data = await getFamilyFeed()
      setCards(data)
    } catch {
      // Surface an empty state rather than crashing on a transient error.
      setCards([])
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }, [load])

  const loading = cards === null

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.container}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.ink900} />
      }
    >
      <Text style={styles.kicker}>{t('family_feed')}</Text>

      {loading ? (
        <View style={styles.centered} testID="family-feed-loading">
          <ActivityIndicator color={colors.ink900} />
        </View>
      ) : cards.length === 0 ? (
        <Text style={styles.emptyText} testID="family-feed-empty">
          {t('family_feed_empty')}
        </Text>
      ) : (
        <View style={{ gap: space[3], marginTop: space[3] }}>
          {cards.map((card) => (
            <View key={card.id} style={styles.card} testID={`family-card-${card.id}`}>
              <View style={styles.thumb}>
                {card.imageThumb || card.imageDisplay || card.image ? (
                  <Image
                    source={{ uri: card.imageThumb || card.imageDisplay || card.image }}
                    cachePolicy="disk"
                    transition={150}
                    style={styles.thumbImg}
                    contentFit="cover"
                  />
                ) : null}
              </View>
              <View style={styles.cardText}>
                <Text style={styles.cardName}>{card.name}</Text>
              </View>
              {asVerdict(card.verdict) ? (
                <VerdictStamp verdict={asVerdict(card.verdict)!} size="sm" />
              ) : null}
            </View>
          ))}
        </View>
      )}
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
  kicker: {
    color: colors.ink400,
    fontSize: 10,
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  centered: {
    paddingVertical: 24,
    alignItems: 'center',
  },
  emptyText: {
    color: colors.ink500,
    fontSize: 14,
    marginTop: 8,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    borderWidth: 2,
    borderColor: colors.ink200,
    borderRadius: radius.md,
    padding: 10,
  },
  thumb: {
    width: 54,
    height: 54,
    borderRadius: radius.sm,
    borderWidth: 2,
    borderColor: colors.ink900,
    backgroundColor: colors.paper2,
    overflow: 'hidden',
    flexShrink: 0,
  },
  thumbImg: {
    width: '100%',
    height: '100%',
  },
  cardText: {
    flex: 1,
    minWidth: 0,
  },
  cardName: {
    fontWeight: '700',
    fontSize: 16,
    color: colors.ink900,
  },
})
