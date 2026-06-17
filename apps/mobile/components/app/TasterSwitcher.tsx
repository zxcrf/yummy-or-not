/* ============================================================
   YUMMY OR NOT — TasterSwitcher (plan 5 redesign)

   Right-top avatar bubble + chevron. Tapping opens a bottom sheet
   listing all tasters (current one checked). A banner appears below
   the header when viewing a non-self taster's tastes.

   Gating (§S3b 权限):
   - All users see their own avatar (so there's always a visible right-top
     element, even free/single-taster).
   - The chevron + bottom sheet only appear when there are multiple tasters
     (i.e. the user can actually switch). Free users with only one persona
     never see the sheet trigger.
   - The banner only appears when a non-self taster is currently active.
   ============================================================ */

import { useState } from 'react'
import { Modal, Pressable, StyleSheet, View } from 'react-native'
import { Text, colors, space, radius } from '@/theme'
import { useActiveTaster, setActiveTaster } from '@/app/(tabs)/_useActiveTaster'
import { useTasters } from '@/app/(tabs)/_useTasters'
import { Icon } from '@/components/ds/Icon'
import { useI18n } from '@/providers/I18nProvider'

export default function TasterSwitcher() {
  const { t } = useI18n()
  const active = useActiveTaster()
  const { tasters } = useTasters()
  const [sheetOpen, setSheetOpen] = useState(false)

  // Determine the currently active taster object.
  // active === null means self is active.
  const activeTaster =
    active === null
      ? tasters.find((t) => t.isSelf) ?? tasters[0]
      : tasters.find((t) => t.id === active)

  const selfTaster = tasters.find((t) => t.isSelf) ?? tasters[0]

  // Display the active taster's initial; fall back to self.
  const displayTaster = activeTaster ?? selfTaster
  const initial = displayTaster?.displayName?.[0]?.toUpperCase() ?? '?'

  // Multi-taster: chevron and sheet are available.
  const isMultiTaster = tasters.length > 1

  // Non-self taster active → show banner.
  const nonSelfActive = active !== null && activeTaster != null && !activeTaster.isSelf

  return (
    <View>
      {/* Avatar bubble (+ chevron if multi-taster) — the sheet trigger */}
      <Pressable
        testID="taster-sheet-open"
        accessibilityRole="button"
        onPress={() => {
          if (isMultiTaster) setSheetOpen(true)
        }}
        style={styles.avatarRow}
      >
        <View testID="taster-avatar" style={styles.avatarCircle}>
          <Text style={styles.avatarInitial}>{initial}</Text>
        </View>
        {isMultiTaster && (
          <View testID="taster-chevron">
            <Icon name="chevron-down" size={16} color={colors.ink900} />
          </View>
        )}
      </Pressable>

      {/* Banner: shown when a non-self taster is active */}
      {nonSelfActive && activeTaster != null && (
        <View testID="viewing-banner" style={styles.banner}>
          <Text style={styles.bannerText}>
            {t('viewing_taster', { name: activeTaster.displayName })}
          </Text>
        </View>
      )}

      {/* Bottom sheet: list of all tasters */}
      {sheetOpen && (
        <Pressable
          testID="taster-sheet-overlay"
          style={[StyleSheet.absoluteFill, styles.overlay]}
          onPress={() => setSheetOpen(false)}
        >
          <Pressable
            testID="taster-sheet"
            style={styles.sheet}
            onPress={() => {}}
          >
            <Text style={styles.sheetTitle}>{t('taster_sheet_title')}</Text>
            {tasters.map((taster) => {
              const isActive = taster.isSelf ? active === null : active === taster.id
              return (
                <Pressable
                  key={taster.id}
                  testID={`taster-row-${taster.id}`}
                  accessibilityRole="button"
                  accessibilityLabel={taster.displayName}
                  accessibilityState={{ selected: isActive }}
                  onPress={() => {
                    setActiveTaster(taster.isSelf ? null : taster.id)
                    setSheetOpen(false)
                  }}
                  style={styles.sheetRow}
                >
                  <View style={styles.sheetRowAvatar}>
                    <Text style={styles.sheetRowInitial}>
                      {taster.displayName[0]?.toUpperCase() ?? '?'}
                    </Text>
                  </View>
                  <Text style={styles.sheetRowName}>{taster.displayName}</Text>
                  {taster.isSelf && (
                    <Text style={styles.sheetRowSelf}>{t('taster_self_label')}</Text>
                  )}
                  {isActive && (
                    <Icon name="check" size={18} color={colors.ink900} />
                  )}
                </Pressable>
              )
            })}
          </Pressable>
        </Pressable>
      )}
    </View>
  )
}

const AVATAR_SIZE = 32

const styles = StyleSheet.create({
  avatarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1],
  },
  avatarCircle: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    backgroundColor: colors.ink900,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    color: colors.onBrand,
    fontSize: 14,
    fontWeight: '700',
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
  overlay: {
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.backgroundStrong,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: space[6],
    paddingBottom: space[8],
  },
  sheetTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.ink900,
    marginBottom: space[3],
  },
  sheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: space[3],
    gap: space[3],
  },
  sheetRowAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.ink200,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetRowInitial: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.ink900,
  },
  sheetRowName: {
    flex: 1,
    fontSize: 16,
    color: colors.ink900,
  },
  sheetRowSelf: {
    fontSize: 13,
    color: colors.ink500,
  },
})
