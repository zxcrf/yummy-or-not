/* ============================================================
   YUMMY OR NOT — TasterSwitcher (S3b)

   A horizontal persona switcher sitting atop the taste surfaces
   (Library / Stats). One chip per taster; the self-taster is the
   default (active === null means self). Selecting a persona sets the
   client active taster — which the new-taste POST then carries.

   Gating (§S3b 权限): taster CRUD + multi-taster is pro-only, so for a
   FREE account the switcher renders NOTHING — free users only ever have
   the self-taster and must not see a switch UI for personas they cannot
   own. The server is the source of truth (this is UI affordance only).
   ============================================================ */

import { Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { Text, colors, radius, space } from '@/theme'
import { useAuth } from '@/providers/AuthProvider'
import { useActiveTaster, setActiveTaster } from '@/app/(tabs)/_useActiveTaster'
import { useTasters } from '@/app/(tabs)/_useTasters'

export default function TasterSwitcher() {
  const { user } = useAuth()
  const active = useActiveTaster()
  const { tasters } = useTasters()

  // Free accounts cannot own multiple personas — hide the switcher entirely.
  if (user?.plan !== 'pro') return null
  if (tasters.length === 0) return null

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
      style={styles.scrollView}
      accessibilityLabel="taster-switcher"
    >
      {tasters.map((taster) => {
        // active === null means the self-taster is selected.
        const isActive = taster.isSelf ? active === null : active === taster.id
        return (
          <Pressable
            key={taster.id}
            accessibilityRole="button"
            accessibilityLabel={taster.displayName}
            accessibilityState={{ selected: isActive }}
            onPress={() => setActiveTaster(taster.isSelf ? null : taster.id)}
            style={[styles.chip, isActive && styles.chipActive]}
          >
            <Text style={[styles.chipText, isActive && styles.chipTextActive]}>
              {taster.displayName}
            </Text>
          </Pressable>
        )
      })}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  scrollView: {
    flexGrow: 0,
    flexShrink: 0,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    paddingHorizontal: space[4],
    paddingVertical: space[2],
  },
  chip: {
    paddingHorizontal: space[3],
    paddingVertical: space[1],
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.ink900,
    backgroundColor: colors.background,
  },
  chipActive: {
    backgroundColor: colors.ink900,
  },
  chipText: {
    fontSize: 14,
    color: colors.ink900,
  },
  chipTextActive: {
    color: colors.onBrand,
  },
})
