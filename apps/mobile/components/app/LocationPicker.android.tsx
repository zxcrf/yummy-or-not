/* ============================================================
   YUMMY OR NOT — LocationPicker (Android, AMap center-pin)

   A full-screen map sheet for setting a taste's PHYSICAL pin (lat/lng),
   separate from its place NICKNAME. Center-pin UX: a fixed pin sits in the
   middle of the screen; the user drags the map under it and the pin's target
   coordinate is read from the camera center on idle, then reverse-geocoded for
   a human-readable address preview. Confirm returns WGS-84 coords + the
   resolved address; the caller decides what to do with them.

   COORDINATE SYSTEM: stored coords are WGS-84; AMap renders GCJ-02. We convert
   on the way IN (wgs84ToGcj02 for the initial camera) and on the way OUT
   (gcj02ToWgs84 for the picked center) so the stored pin lines up with the rest
   of the app (createTaste / reverseGeocode all speak WGS-84).

   COMPLIANCE: identical AMap consent gate to NearbyHeatView — the SDK is NOT
   initialized until the user has explicitly agreed (高德《合规使用方案》). Consent
   is shared via the same AsyncStorage key, so agreeing in either surface
   unlocks both. Native MapView → NOT jest-tested (mirrors NearbyHeatView); the
   pure coordinate math it leans on lives in @yon/shared and IS unit-tested.
   ============================================================ */

import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { MapView } from 'react-native-amap3d'
import { reverseGeocode } from '@yon/shared'

import { initAmapIfConsented } from '@/lib/amapPrivacy'
import {
  PICKER_FALLBACK,
  initialCameraFromPin,
  pinFromCameraTarget,
} from '@/lib/locationPicker'
import { requestLocateResult } from '@/app/(tabs)/_useUserCoords'
import { useI18n } from '@/providers/I18nProvider'
import { Button, Card, Icon } from '@/components/ds'
import { colors, space, radius, Text } from '@/theme'

// Shared with NearbyHeatView — agreeing in either surface unlocks both. Kept in
// sync by value (a storage key never changes); see NearbyHeatView CONSENT_KEY.
const CONSENT_KEY = 'yon_amap_consent'
const REVERSE_DEBOUNCE_MS = 500

export interface LatLngLiteral {
  lat: number
  lng: number
}

export interface LocationPickerProps {
  visible: boolean
  /** Existing pin (WGS-84) to open on, or null to start at the GPS / fallback center. */
  initial: LatLngLiteral | null
  onCancel: () => void
  /** Fires with the chosen pin (WGS-84) and the reverse-geocoded address (or null). */
  onConfirm: (coords: LatLngLiteral, place: string | null) => void
}

export default function LocationPicker({ visible, initial, onCancel, onConfirm }: LocationPickerProps) {
  const { t } = useI18n()
  const [consent, setConsent] = useState<boolean | null>(null) // null = loading
  // The live pin (WGS-84) under the center crosshair, updated on camera idle.
  const [pin, setPin] = useState<LatLngLiteral | null>(null)
  const [address, setAddress] = useState<string | null>(null)
  const [resolving, setResolving] = useState(false)

  const mapRef = useRef<InstanceType<typeof MapView> | null>(null)
  const reverseTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reverseSeq = useRef(0)

  // Seed the pin from the incoming prop each time the sheet opens so reopening on
  // a different taste never shows the previous one's coordinates.
  useEffect(() => {
    if (!visible) return
    setPin(initial)
    setAddress(null)
  }, [visible, initial])

  // Restore persisted consent when the sheet opens; init the SDK if granted.
  useEffect(() => {
    if (!visible) return
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
  }, [visible])

  useEffect(() => {
    return () => {
      if (reverseTimer.current) clearTimeout(reverseTimer.current)
    }
  }, [])

  const grantConsent = useCallback(async () => {
    initAmapIfConsented(true)
    setConsent(true)
    try {
      await AsyncStorage.setItem(CONSENT_KEY, 'true')
    } catch {
      // Non-fatal — consent still holds for this session.
    }
  }, [])

  // Debounced reverse-geocode of the current pin. A failure leaves the address
  // blank (never blocks confirming) — coords are the source of truth.
  const scheduleReverse = useCallback((wgs: LatLngLiteral) => {
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

  // onCameraIdle fires after each pan/zoom settles. cameraPosition.target is the
  // GCJ-02 center under the fixed pin → convert to WGS-84 for storage + reverse.
  const onCameraIdle = useCallback(
    (e: { nativeEvent: { cameraPosition: { target?: { latitude: number; longitude: number } } } }) => {
      const target = e.nativeEvent.cameraPosition.target
      if (!target) return
      const wgs = pinFromCameraTarget(target)
      setPin(wgs)
      scheduleReverse(wgs)
    },
    [scheduleReverse],
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

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onCancel} transparent={false}>
      <View style={styles.container}>
        {/* Header: cancel ✕ + title + confirm. */}
        <View style={styles.header}>
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
                <Button variant="primary" block onPress={grantConsent} style={{ marginTop: space[2] }}>
                  {t('loc_consent_agree')}
                </Button>
              </View>
            </Card>
          </ScrollView>
        ) : (
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

            {/* Address preview / hint card pinned to the bottom. */}
            <View style={styles.footer} pointerEvents="none">
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
    </Modal>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space[3],
    paddingTop: space[5],
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
    // Lift the pin so its tip (bottom) sits on the camera center.
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
