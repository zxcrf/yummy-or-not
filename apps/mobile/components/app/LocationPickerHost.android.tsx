/* ============================================================
   YUMMY OR NOT — LocationPickerHost (Android, AMap center-pin)

   The single, app-root map picker (mounted once by LocationPickerProvider).
   Center-pin UX: a fixed pin sits in the screen middle; the user drags the map
   under it; the camera centre on idle is the chosen point, reverse-geocoded for
   an address preview. Confirm returns WGS-84 coords + the address.

   ⚠️ NEVER UNMOUNTS THE MAP. react-native-amap3d crashes the app when its native
   MapView is destroyed (MapViewManager.onDropViewInstance → TextureMapView
   .onDestroy NPEs). So once the user has opened the picker and consented, the
   <MapView> stays mounted for the app's lifetime; closing only hides the overlay
   with display:none (no unmount → no onDestroy → no crash). Reopening recenters
   the live map via moveCamera (initialCameraPosition only applies on first mount).

   COORDINATE SYSTEM: stored coords are WGS-84; AMap renders GCJ-02. We convert in
   (wgs84ToGcj02) and out (gcj02ToWgs84) so the stored pin matches the rest of the
   app. COMPLIANCE: the AMap SDK is not initialised until the user agrees (shared
   consent key with NearbyHeatView).
   ============================================================ */

import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, BackHandler, Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { MapView } from 'react-native-amap3d'
import { reverseGeocode } from '@yon/shared'

import { initAmapIfConsented } from '@/lib/amapPrivacy'
import {
  PICKER_FALLBACK,
  initialCameraFromPin,
  pinFromCameraTarget,
  type LatLng,
} from '@/lib/locationPicker'
import { requestLocateResult } from '@/app/(tabs)/_useUserCoords'
import { useI18n } from '@/providers/I18nProvider'
import { Button, Card, Icon } from '@/components/ds'
import { colors, space, radius, Text } from '@/theme'

// Shared with NearbyHeatView — agreeing in either surface unlocks both.
const CONSENT_KEY = 'yon_amap_consent'
const REVERSE_DEBOUNCE_MS = 500

export interface LocationPickerHostProps {
  /** True while the picker is open (overlay shown). When false the overlay is
   *  hidden with display:none but the consented map stays mounted underneath. */
  visible: boolean
  /** Seed pin (WGS-84) for the current open, or null for the GPS/fallback centre. */
  initial: LatLng | null
  /** Latches true on the first open; keeps the map mounted forever after. */
  keepMounted: boolean
  onCancel: () => void
  onConfirm: (coords: LatLng, place: string | null) => void
}

export default function LocationPickerHost({
  visible,
  initial,
  keepMounted,
  onCancel,
  onConfirm,
}: LocationPickerHostProps) {
  const { t } = useI18n()
  const insets = useSafeAreaInsets()
  const [consent, setConsent] = useState<boolean | null>(null) // null = loading
  const [pin, setPin] = useState<LatLng | null>(null)
  const [address, setAddress] = useState<string | null>(null)
  const [resolving, setResolving] = useState(false)

  const mapRef = useRef<InstanceType<typeof MapView> | null>(null)
  const reverseTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reverseSeq = useRef(0)

  // Restore consent the first time the picker is ever opened; init the SDK if
  // granted. Runs once (keepMounted latches true and never resets).
  useEffect(() => {
    if (!keepMounted) return
    let cancelled = false
    ;(async () => {
      try {
        const stored = await AsyncStorage.getItem(CONSENT_KEY)
        if (cancelled) return
        const granted = stored === 'true'
        if (granted) initAmapIfConsented(true)
        setConsent(granted)
      } catch {
        if (!cancelled) setConsent(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [keepMounted])

  // Seed the pin each time the picker opens (or the seed changes while open) so
  // reopening on a different taste never shows the previous one's coordinates.
  // On reopen the live map is recentred via moveCamera; on the very first open
  // the map isn't mounted yet and picks up initialCameraPosition instead.
  useEffect(() => {
    if (!visible) return
    setPin(initial)
    setAddress(null)
    if (mapRef.current) {
      mapRef.current.moveCamera(initialCameraFromPin(initial ?? PICKER_FALLBACK), 0)
    }
  }, [visible, initial])

  useEffect(() => {
    return () => {
      if (reverseTimer.current) clearTimeout(reverseTimer.current)
    }
  }, [])

  // Android hardware-back / predictive-back: while open, close the picker and
  // CONSUME the event so it never reaches the navigator.
  useEffect(() => {
    if (!visible) return
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onCancel()
      return true
    })
    return () => sub.remove()
  }, [visible, onCancel])

  const grantConsent = useCallback(async () => {
    initAmapIfConsented(true)
    setConsent(true)
    try {
      await AsyncStorage.setItem(CONSENT_KEY, 'true')
    } catch {
      // Non-fatal — consent still holds for this session.
    }
  }, [])

  const scheduleReverse = useCallback((wgs: LatLng) => {
    if (reverseTimer.current) clearTimeout(reverseTimer.current)
    const seq = ++reverseSeq.current
    setResolving(true)
    reverseTimer.current = setTimeout(async () => {
      try {
        const { place } = await reverseGeocode(wgs.lat, wgs.lng)
        if (seq !== reverseSeq.current) return
        setAddress(place)
      } catch {
        if (seq === reverseSeq.current) setAddress(null)
      } finally {
        if (seq === reverseSeq.current) setResolving(false)
      }
    }, REVERSE_DEBOUNCE_MS)
  }, [])

  const onCameraIdle = useCallback(
    (e: { nativeEvent: { cameraPosition: { target?: { latitude: number; longitude: number } } } }) => {
      // Ignore camera events while hidden (a moveCamera during a reseed shouldn't
      // schedule a network reverse-geocode for a picker the user isn't looking at).
      if (!visible) return
      const target = e.nativeEvent.cameraPosition.target
      if (!target) return
      const wgs = pinFromCameraTarget(target)
      setPin(wgs)
      scheduleReverse(wgs)
    },
    [visible, scheduleReverse],
  )

  const recenterOnMe = useCallback(async () => {
    const res = await requestLocateResult()
    if (!res.coords) return
    mapRef.current?.moveCamera(initialCameraFromPin({ lat: res.coords.lat, lng: res.coords.lng }), 400)
  }, [])

  const confirm = useCallback(() => {
    if (!pin) return
    onConfirm(pin, address)
  }, [pin, address, onConfirm])

  // Render nothing (and mount NO native MapView) until the picker has been opened
  // at least once. After that the overlay stays mounted and is shown/hidden via
  // display so the map is never torn down.
  if (!keepMounted) return null

  return (
    <View
      testID="loc-picker-overlay"
      style={[styles.overlay, { display: visible ? 'flex' : 'none' }]}
      pointerEvents={visible ? 'auto' : 'none'}
    >
      <View style={styles.container}>
        {/* Header: cancel ✕ + title + confirm. paddingTop carries the status-bar inset. */}
        <View testID="loc-picker-header" style={[styles.header, { paddingTop: insets.top + space[2] }]}>
          <Pressable testID="loc-picker-cancel" onPress={onCancel} hitSlop={12} style={styles.headerBtn}>
            <Icon name="close" size={22} color={colors.ink900} />
          </Pressable>
          <Text style={styles.title}>{t('loc_picker_title')}</Text>
          <Pressable
            testID="loc-picker-confirm"
            onPress={confirm}
            disabled={!pin}
            hitSlop={12}
            style={[styles.headerBtn, { opacity: pin ? 1 : 0.4 }]}
          >
            <Text style={styles.confirmText}>{t('loc_picker_confirm')}</Text>
          </Pressable>
        </View>

        {consent === null ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.ink900} />
          </View>
        ) : !consent ? (
          <ScrollView contentContainerStyle={{ padding: 20, gap: space[4] }}>
            <Card padded>
              <View style={{ gap: space[3] }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
                  <Icon name="map" size={22} color={colors.ink900} />
                  <Text style={{ fontWeight: '700', fontSize: 18 }}>{t('loc_consent_title')}</Text>
                </View>
                <Text style={{ color: colors.ink500, fontSize: 15, lineHeight: 22 }}>
                  {t('loc_consent_body')}
                </Text>
                <Button variant="primary" block onPress={grantConsent} testID="loc-picker-consent-agree" style={{ marginTop: space[2] }}>
                  {t('loc_consent_agree')}
                </Button>
              </View>
            </Card>
          </ScrollView>
        ) : (
          // consent granted → the MapView stays mounted from here on (never
          // conditionally unmounted; only the outer overlay's display toggles).
          <View style={{ flex: 1 }}>
            <MapView
              ref={mapRef}
              style={{ flex: 1 }}
              initialCameraPosition={initialCameraFromPin(pin ?? PICKER_FALLBACK)}
              onCameraIdle={onCameraIdle}
            />

            {/* Fixed center crosshair — the pin the camera center maps to. */}
            <View pointerEvents="none" style={styles.pinWrap}>
              <Icon name="pin" size={40} color={colors.verdictNah2} />
            </View>

            {/* My-location recenter. */}
            <View style={styles.controls} pointerEvents="box-none">
              <Pressable
                testID="loc-picker-locate"
                accessibilityRole="button"
                onPress={recenterOnMe}
                style={styles.controlBtn}
              >
                <Icon name="pin" size={20} color={colors.ink900} />
              </Pressable>
            </View>

            {/* Address preview / hint card pinned to the bottom (clears the nav bar). */}
            <View style={[styles.footer, { bottom: insets.bottom + space[4] }]} pointerEvents="none">
              <View style={styles.footerCard}>
                <Text style={styles.footerHint}>{t('loc_picker_hint')}</Text>
                <Text testID="loc-picker-address" style={styles.footerAddress} numberOfLines={2}>
                  {resolving ? t('loc_locating') : address || t('loc_pin_none')}
                </Text>
              </View>
            </View>
          </View>
        )}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 1000,
    elevation: 1000,
    backgroundColor: colors.background,
  },
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space[3],
    paddingBottom: space[3],
    borderBottomWidth: 1,
    borderBottomColor: colors.ink100,
  },
  headerBtn: { minWidth: 64, justifyContent: 'center' },
  title: { fontWeight: '700', fontSize: 18, color: colors.ink900 },
  confirmText: { fontWeight: '700', fontSize: 16, color: colors.ink900, textAlign: 'right' },
  pinWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 40,
  },
  controls: { position: 'absolute', right: space[3], top: space[3], gap: space[2] },
  controlBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.white,
    borderWidth: 2,
    borderColor: colors.ink900,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footer: { position: 'absolute', left: space[3], right: space[3], bottom: space[4] },
  footerCard: {
    backgroundColor: colors.white,
    borderWidth: 2,
    borderColor: colors.ink900,
    borderRadius: radius.md,
    padding: space[3],
    gap: space[1],
  },
  footerHint: { color: colors.ink400, fontSize: 12 },
  footerAddress: { color: colors.ink900, fontSize: 15, fontWeight: '600' },
})
