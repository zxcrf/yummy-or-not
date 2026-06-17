/* Library tab — thin route wrapper around components/app/LibraryView.

   Header layout (plan 2 update):
   ┌───────────────────────────────────────────────────────────────┐
   │  [left spacer]                                  [avatar ▾]   │
   └───────────────────────────────────────────────────────────────┘
   The centered title is now owned by LibraryView as a dropdown trigger
   (plan 2). This route only hosts the right-side taster avatar and the
   non-self-taster banner below the header row.
   Banner (if viewing a non-self taster's tastes) sits below the header row.
   LibraryView fills the remaining space and renders its own title/dropdown. */

import { StyleSheet, View } from 'react-native'
import { colors, space } from '@/theme'
import { Text } from '@/theme'
import { useI18n } from '@/providers/I18nProvider'
import LibraryView from '@/components/app/LibraryView'
import TasterSwitcher from '@/components/app/TasterSwitcher'
import { useActiveTaster } from './_useActiveTaster'
import { useTasters } from './_useTasters'
import { useAuth } from '@/providers/AuthProvider'
import { Screen } from './_screen'

export default function LibraryRoute() {
  const { t } = useI18n()
  const { user } = useAuth()
  const active = useActiveTaster()
  const { tasters } = useTasters()

  // Mirror the same gate as TasterSwitcher so the banner logic is consistent.
  const isMultiTaster = user?.plan === 'pro' && tasters.length > 1
  const activeTaster =
    active === null
      ? tasters.find((ts) => ts.isSelf) ?? tasters[0]
      : tasters.find((ts) => ts.id === active)
  const nonSelfActive =
    isMultiTaster && active !== null && activeTaster != null && !activeTaster.isSelf

  return (
    <Screen>
      {/* ── Header row: right-side avatar only (title is in LibraryView) ── */}
      <View style={styles.header}>
        {/* Right slot: taster avatar + optional chevron */}
        <View style={styles.headerRight}>
          <TasterSwitcher />
        </View>
      </View>

      {/* ── Banner (non-self taster active) ─────────────────────────────── */}
      {nonSelfActive && activeTaster != null && (
        <View testID="header-viewing-banner" style={styles.banner}>
          <Text style={styles.bannerText}>
            {t('viewing_taster', { name: activeTaster.displayName })}
          </Text>
        </View>
      )}

      {/* ── Library content (owns its own title dropdown) ───────────────── */}
      <LibraryView />
    </Screen>
  )
}

const HEADER_HEIGHT = 48

const styles = StyleSheet.create({
  header: {
    height: HEADER_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingHorizontal: space[4],
    backgroundColor: colors.background,
  },
  headerRight: {
    alignItems: 'flex-end',
  },
  banner: {
    paddingHorizontal: space[4],
    paddingVertical: space[1],
    backgroundColor: colors.ink100,
  },
  bannerText: {
    fontSize: 12,
    color: colors.ink500,
    textAlign: 'center',
  },
})
