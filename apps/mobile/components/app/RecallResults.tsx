/* ============================================================
   YUMMY OR NOT — RecallResults (plain RN + theme)
   The "before you spend" answer surface, rendered inside the Library
   (口味) view when there's an active search query. Given a tasted-only
   `pool` and a `query`, it shows scored results from searchTastes:
   - top match → big verdict card (warn styling when warnBeforeBuy and
     the user has warnings enabled)
   - additional matches → compact "Other matches" group
   - no-record empty state that links to Add

   It owns NO search box and NO data fetching — the Library view owns the
   input and passes the already filtered pool + query down. todo (想吃)
   items never reach here: the pool is tasted-only, and the wishlist lives
   in its own To-Try tab.
   ============================================================ */

import { useMemo } from 'react'
import { Pressable, View } from 'react-native'
import { Image } from 'expo-image'
import { useRouter } from 'expo-router'
import { colors, space, radius, Text } from '@/theme'
import { searchTastes, type Taste, type Verdict } from '@yon/shared'
import { Button, Card, Icon, VerdictStamp } from '@/components/ds'
import { useI18n } from '@/providers/I18nProvider'
import { useAuth } from '@/providers/AuthProvider'

const ACCENT_BG: Record<Verdict, string> = {
  yum: colors.verdictYum,
  meh: colors.verdictMeh,
  nah: colors.verdictNah,
}

const VERDICT_KEY: Record<Verdict, string> = {
  yum: 'loved_it',
  meh: 'soso',
  nah: 'skip_it',
}

function RecallRow({
  item,
  onPress,
  flat,
  warnActive,
}: {
  item: Taste
  onPress: () => void
  flat?: boolean
  warnActive?: boolean
}) {
  const { t } = useI18n()
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={{ width: '100%' }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: space[3],
          width: '100%',
          backgroundColor: flat ? 'transparent' : colors.white,
          borderWidth: flat ? 0 : 3,
          borderColor: warnActive ? colors.verdictNah2 : colors.ink900,
          borderRadius: radius.md,
          padding: flat ? 0 : 10,
          ...(flat
            ? {}
            : {
                shadowColor: warnActive ? colors.verdictNah2 : colors.ink900,
                shadowOffset: { width: 3, height: 3 },
                shadowOpacity: 1,
                shadowRadius: 0,
              }),
        }}
      >
        <View
          style={{
            width: 54,
            height: 54,
            borderRadius: radius.sm,
            borderWidth: 2,
            borderColor: colors.ink900,
            backgroundColor: colors.paper2,
            overflow: 'hidden',
            flexShrink: 0,
          }}
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
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontWeight: '700', fontSize: 16 }}>
            {item.name}
          </Text>
          <Text style={{ color: colors.ink500, fontSize: 13 }}>
            {item.place} · {item.date}
          </Text>
        </View>
        {item.verdict != null ? (
          <VerdictStamp verdict={item.verdict} size="sm" label={t('v_' + item.verdict)} />
        ) : null}
      </View>
    </Pressable>
  )
}

export function RecallResults({ pool, query }: { pool: Taste[]; query: string }) {
  const { t } = useI18n()
  const router = useRouter()
  const { user } = useAuth()

  const results = useMemo(() => searchTastes(pool, query), [pool, query])
  const topMatch = results[0]?.item ?? null
  const otherMatches = results.slice(1).map((r) => r.item)

  // Warn styling applies only when the taste has the flag set and the user has
  // warnings enabled globally. Falls back to plain display otherwise.
  const warningsOn = user?.warningsEnabled ?? false
  const topWarn = warningsOn && (topMatch?.warnBeforeBuy ?? false)

  if (!topMatch) {
    return (
      <Card padded>
        <View style={{ alignItems: 'center', gap: space[2], paddingVertical: 24 }}>
          <Icon name="info-box" size={40} color={colors.ink300} />
          <Text style={{ fontWeight: '600', fontSize: 18, textAlign: 'center' }}>
            {t('no_record', { q: query })}
          </Text>
          <Text style={{ color: colors.ink500, textAlign: 'center' }}>
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
        </View>
      </Card>
    )
  }

  return (
    <View style={{ gap: space[3] }}>
      {/* top result — big verdict card */}
      <Card variant="raised">
        <View
          style={{
            backgroundColor: topWarn
              ? colors.verdictNah
              : topMatch.verdict
              ? ACCENT_BG[topMatch.verdict]
              : colors.paper2,
            paddingHorizontal: 22,
            paddingTop: 22,
            paddingBottom: 20,
            borderBottomWidth: 3,
            borderColor: topWarn ? colors.verdictNah2 : colors.ink900,
          }}
        >
          {topWarn ? (
            <>
              <Text
                style={{ fontSize: 11, letterSpacing: 1.3, textTransform: 'uppercase', opacity: 0.9 }}
              >
                {t('verdict_on_file')}
              </Text>
              <Text style={{ fontWeight: '700', fontSize: 28, lineHeight: 34, marginTop: space[1] }}>
                {t('recall_warn_skip')}
              </Text>
            </>
          ) : topMatch.verdict != null ? (
            <>
              <Text
                style={{ fontSize: 11, letterSpacing: 1.3, textTransform: 'uppercase', opacity: 0.9 }}
              >
                {t('verdict_on_file')}
              </Text>
              <Text style={{ fontWeight: '700', fontSize: 46, lineHeight: 52, marginTop: space[1] }}>
                {t(VERDICT_KEY[topMatch.verdict])}
              </Text>
            </>
          ) : null}
        </View>
        <View style={{ padding: 18 }}>
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
        <View style={{ gap: space[2] }}>
          <Text
            style={{ color: colors.ink400, fontSize: 10, letterSpacing: 1, textTransform: 'uppercase' }}
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
        </View>
      ) : null}
    </View>
  )
}

export default RecallResults
