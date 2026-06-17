/* Library tab — thin route wrapper around components/app/LibraryView.

   Header layout (plan 5):
   ┌─────────────────────────────────────────────┐
   │  [centered title — plan 2 will make dropdown] │  [avatar ▾]  │
   └─────────────────────────────────────────────┘
   Banner (if viewing a non-self taster's tastes) sits below the header row.
   LibraryView fills the remaining space.

   Coordination note: plan 2 will convert the centered title into a dropdown.
   That title element is intentionally left as a plain <Text> here; plan 2 only
   needs to replace it. The right-side avatar + banner are owned by this plan. */

import { StyleSheet, View } from 'react-native'
import { Text, colors, space } from '@/theme'
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
      ? tasters.find((t) => t.isSelf) ?? tasters[0]
      : tasters.find((t) => t.id === active)
  const nonSelfActive =
    isMultiTaster && active !== null && activeTaster != null && !activeTaster.isSelf

  return (
    <Screen>
      {/* ── Header row ──────────────────────────────────────────────────── */}
      <View style={styles.header}>
        {/* Left spacer mirrors the right avatar width so the title stays centered */}
        <View style={styles.headerSide} />

        {/* Centered title — plan 2 will replace this with a dropdown */}
        <Text style={styles.headerTitle} accessibilityRole="header">
          {t('lib_tab_tasted')}
        </Text>

        {/* Right slot: taster avatar + optional chevron */}
        <View style={styles.headerSide}>
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

      {/* ── Library content ─────────────────────────────────────────────── */}
      <LibraryView />
    </Screen>
  )
}

const HEADER_HEIGHT = 48
const SIDE_WIDTH = 56 // enough room for a 32 px avatar + chevron

const styles = StyleSheet.create({
  header: {
    height: HEADER_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space[4],
    backgroundColor: colors.background,
  },
  headerSide: {
    width: SIDE_WIDTH,
    alignItems: 'flex-end',
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 17,
    fontWeight: '600',
    color: colors.ink900,
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
