/* ============================================================
   YUMMY OR NOT — NearbyHeatView ("附近 · 热力")
   AMap real-map heatmap (Android). Consumes the ALREADY-LIVE geo
   endpoints via @yon/shared (getGeoHeat / getGeoFeedByCell). NOT
   jest-tested — it mounts a native MapView. The pure logic it leans on
   (regionToBbox / decideHeatFetch / heatColorForCount) lives in
   lib/heatView.ts and IS unit-tested.

   PRIVACY / COMPLIANCE:
   - AMap《合规使用方案》: the SDK must NOT init before the user has seen
     the privacy text and consented. We gate behind a consent view first;
     only after consent do we call initAmapIfConsented(true) (which drives
     updatePrivacyShow/updatePrivacyAgree before init) and mount the map.
   - Grid is FIXED geohash precision-5. We never query finer than a cell:
     decideHeatFetch refuses oversized bboxes (would 400 area_too_large)
     and we show a "放大查看" hint instead of rendering stale/empty as data.
   - Cell centers/rects come from geohashCellRectGcj02 — already WGS84→GCJ-02
     converted, so they align with AMap's coordinate system (no drift).
   - We only ever show the coarsened GeoFeedCard list for a cell (name,
     verdict, thumb) — never a precise coordinate or identity.
   ============================================================ */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Modal, Pressable, ScrollView, View } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Image } from 'expo-image'
import { MapView, Polygon } from 'react-native-amap3d'
import {
  gcj02ToWgs84,
  geohashCellRectGcj02,
  getGeoHeat,
  getGeoFeedByCell,
  wgs84ToGcj02,
  type GeoFeedCard,
} from '@yon/shared'

// Known verdict literals — render a stamp only for these (see Verdict union).
const VERDICTS = ['yum', 'meh', 'nah'] as const
type KnownVerdict = (typeof VERDICTS)[number]
function asVerdict(v: unknown): KnownVerdict | null {
  return typeof v === 'string' && (VERDICTS as readonly string[]).includes(v)
    ? (v as KnownVerdict)
    : null
}

import { initAmapIfConsented } from '@/lib/amapPrivacy'
import { decideHeatFetch, heatColorForCount, regionToBbox, type Bbox } from '@/lib/heatView'
import { Button, Card, Icon, VerdictStamp } from '@/components/ds'
import { colors, space, radius, Text } from '@/theme'

const CONSENT_KEY = 'yon_amap_consent'
const DEBOUNCE_MS = 300

// Shanghai People's Square — a sane default camera until the map settles.
const INITIAL = {
  latitude: 31.2304,
  longitude: 121.4737,
  zoom: 13,
}

interface HeatCell {
  cell: string
  count: number
  /** GCJ-02 corners for the amap Polygon. */
  points: Array<{ latitude: number; longitude: number }>
}

/** Bounds of a cell's GCJ-02 rect, for hit-testing a map tap to a cell. */
function rectBounds(points: Array<{ latitude: number; longitude: number }>) {
  const lats = points.map((p) => p.latitude)
  const lngs = points.map((p) => p.longitude)
  return {
    minLat: Math.min(...lats),
    maxLat: Math.max(...lats),
    minLng: Math.min(...lngs),
    maxLng: Math.max(...lngs),
  }
}

export default function NearbyHeatView() {
  const [consent, setConsent] = useState<boolean | null>(null) // null = loading
  const [cells, setCells] = useState<HeatCell[]>([])
  const [hint, setHint] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // Selected-cell bottom sheet.
  const [sheetCell, setSheetCell] = useState<string | null>(null)
  const [sheetCards, setSheetCards] = useState<GeoFeedCard[] | null>(null)
  const [sheetLoading, setSheetLoading] = useState(false)

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reqSeq = useRef(0)

  // Restore persisted consent on mount; init the SDK if already consented.
  useEffect(() => {
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
  }, [])

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  const grantConsent = useCallback(async () => {
    // Init the SDK only AFTER explicit consent (compliance gate).
    initAmapIfConsented(true)
    setConsent(true)
    try {
      await AsyncStorage.setItem(CONSENT_KEY, 'true')
    } catch {
      // Non-fatal — consent still holds for this session.
    }
  }, [])

  const loadHeat = useCallback(async (box: Bbox) => {
    const decision = decideHeatFetch(box)
    if (!decision.fetch) {
      // Zoom-cap: oversized bbox would 400 area_too_large. Clear stale cells
      // so we never render old/empty data as if it were fresh.
      setCells([])
      setHint('放大查看附近热力')
      setLoading(false)
      return
    }

    const seq = ++reqSeq.current
    setLoading(true)
    try {
      const heat = await getGeoHeat(box)
      if (seq !== reqSeq.current) return // a newer move superseded this one
      const next: HeatCell[] = heat.map(({ cell, count }) => ({
        cell,
        count,
        points: geohashCellRectGcj02(cell),
      }))
      setCells(next)
      setHint(next.length === 0 ? '这一带还没有公开的味道' : null)
    } catch (err) {
      if (seq !== reqSeq.current) return
      const code = err instanceof Error ? err.message : ''
      // area_too_large / bbox_required → degrade to a hint, never crash.
      setCells([])
      setHint(code === 'area_too_large' ? '放大查看附近热力' : '加载失败，稍后再试')
    } finally {
      if (seq === reqSeq.current) setLoading(false)
    }
  }, [])

  // onCameraIdle fires after the user stops panning/zooming. The event payload
  // is amap3d's CameraEvent ({ cameraPosition, latLngBounds }); latLngBounds is
  // a LatLngBounds ({ southwest, northeast }) in GCJ-02 device coords.
  //
  // CRS BOUNDARY: the heat bbox sent to getGeoHeat must be in WGS-84 (the
  // server's geohash space). AMap gives us GCJ-02, so we convert EACH viewport
  // corner via gcj02ToWgs84 BEFORE building the bbox. (Cell-RENDER coords stay
  // GCJ-02 via geohashCellRectGcj02 — that path is correct for drawing on AMap.)
  const onCameraIdle = useCallback(
    (e: {
      nativeEvent: {
        latLngBounds?: {
          southwest: { latitude: number; longitude: number }
          northeast: { latitude: number; longitude: number }
        }
      }
    }) => {
      const b = e.nativeEvent.latLngBounds
      if (!b) return
      // GCJ-02 → WGS-84 per corner (crosses the CRS boundary here).
      const sw = gcj02ToWgs84(b.southwest.latitude, b.southwest.longitude)
      const ne = gcj02ToWgs84(b.northeast.latitude, b.northeast.longitude)
      const region = {
        latitude: (sw.lat + ne.lat) / 2,
        longitude: (sw.lng + ne.lng) / 2,
        latitudeDelta: Math.abs(ne.lat - sw.lat),
        longitudeDelta: Math.abs(ne.lng - sw.lng),
      }
      const box = regionToBbox(region)
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        void loadHeat(box)
      }, DEBOUNCE_MS)
    },
    [loadHeat],
  )

  const openCellSheet = useCallback(async (cell: string) => {
    setSheetCell(cell)
    setSheetCards(null)
    setSheetLoading(true)
    try {
      const cards = await getGeoFeedByCell(cell)
      setSheetCards(cards)
    } catch {
      setSheetCards([])
    } finally {
      setSheetLoading(false)
    }
  }, [])

  const closeSheet = useCallback(() => {
    setSheetCell(null)
    setSheetCards(null)
  }, [])

  // A map tap maps to the cell whose GCJ-02 rect contains the tapped point.
  // Polygon in amap3d@3.2.4 has no onPress, so we hit-test against the
  // rendered cells (all coarsened to precision-5 — no precise coord exposed).
  const onMapPress = useCallback(
    (e: { nativeEvent: { latitude: number; longitude: number } }) => {
      const { latitude, longitude } = e.nativeEvent
      const hit = cells.find((c) => {
        const r = rectBounds(c.points)
        return (
          latitude >= r.minLat &&
          latitude <= r.maxLat &&
          longitude >= r.minLng &&
          longitude <= r.maxLng
        )
      })
      if (hit) void openCellSheet(hit.cell)
    },
    [cells, openCellSheet],
  )

  const initialCameraPosition = useMemo(
    () => {
      const c = wgs84ToGcj02(INITIAL.latitude, INITIAL.longitude)
      return { target: { latitude: c.lat, longitude: c.lng }, zoom: INITIAL.zoom }
    },
    [],
  )

  // --- Loading consent state ---
  if (consent === null) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.ink900} />
      </View>
    )
  }

  // --- Consent gate (compliance): SDK NOT initialized until user agrees ---
  if (!consent) {
    return (
      <ScrollView
        style={{ flex: 1, backgroundColor: colors.background }}
        contentContainerStyle={{ padding: 20, gap: space[4], paddingBottom: 40 }}
      >
        <Text style={{ fontWeight: '700', fontSize: 28, lineHeight: 32 }}>附近 · 热力</Text>
        <Card padded>
          <View style={{ gap: space[3] }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
              <Icon name="map" size={22} color={colors.ink900} />
              <Text style={{ fontWeight: '700', fontSize: 18 }}>地图与隐私授权</Text>
            </View>
            <Text style={{ color: colors.ink500, fontSize: 15, lineHeight: 22 }}>
              此功能使用高德地图 SDK 展示附近被公开分享的味道热力图。开启后，应用会按照高德《合规使用方案》初始化地图
              SDK，可能收集设备与网络信息以提供地图服务。热力图仅展示聚合到约 5 公里网格的公开数据，不会显示任何具体位置或用户身份。
            </Text>
            <Text style={{ color: colors.ink400, fontSize: 13, lineHeight: 20 }}>
              你可在隐私政策中了解详情。点击“同意并开启”即表示你已阅读并同意上述说明与高德地图隐私政策。
            </Text>
            <Button variant="primary" block onPress={grantConsent} style={{ marginTop: space[2] }}>
              同意并开启
            </Button>
          </View>
        </Card>
      </ScrollView>
    )
  }

  // --- Map (consent granted, SDK initialized) ---
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <MapView
        style={{ flex: 1 }}
        initialCameraPosition={initialCameraPosition}
        // Native gestures own pan/zoom — we don't reimplement them.
        onCameraIdle={onCameraIdle}
        onPress={onMapPress}
      >
        {cells.map((c) => (
          <Polygon
            key={c.cell}
            points={c.points}
            fillColor={heatColorForCount(c.count)}
            strokeColor="rgba(25,16,23,0.25)"
            strokeWidth={1}
          />
        ))}
      </MapView>

      {/* Status banner: zoom hint, empty hint, or loading. */}
      {hint ? (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: space[3],
            alignSelf: 'center',
            backgroundColor: colors.white,
            borderWidth: 2,
            borderColor: colors.ink900,
            borderRadius: radius.pill,
            paddingHorizontal: 14,
            paddingVertical: 8,
          }}
        >
          <Text style={{ fontWeight: '600', fontSize: 13 }}>{hint}</Text>
        </View>
      ) : null}
      {loading && !hint ? (
        <View style={{ position: 'absolute', top: space[3], alignSelf: 'center' }}>
          <ActivityIndicator color={colors.ink900} />
        </View>
      ) : null}

      {/* Cell bottom sheet — coarsened cards only (name / verdict / thumb). */}
      <Modal visible={sheetCell != null} transparent animationType="slide" onRequestClose={closeSheet}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }} onPress={closeSheet}>
          <Pressable
            style={{
              backgroundColor: '#fff',
              borderTopLeftRadius: 16,
              borderTopRightRadius: 16,
              padding: 20,
              paddingBottom: 36,
              maxHeight: '70%',
            }}
            onPress={() => {}}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space[3] }}>
              <Text style={{ fontWeight: '700', fontSize: 18 }}>这一带的味道</Text>
              <Pressable onPress={closeSheet} accessibilityRole="button" style={{ padding: 4 }}>
                <Icon name="close" size={20} color={colors.ink500} />
              </Pressable>
            </View>
            {sheetLoading ? (
              <View style={{ paddingVertical: 24, alignItems: 'center' }}>
                <ActivityIndicator color={colors.ink900} />
              </View>
            ) : sheetCards && sheetCards.length > 0 ? (
              <ScrollView style={{ maxHeight: 360 }}>
                <View style={{ gap: space[3] }}>
                  {sheetCards.map((card) => (
                    <View
                      key={card.id}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: space[3],
                        borderWidth: 2,
                        borderColor: colors.ink200,
                        borderRadius: radius.md,
                        padding: 10,
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
                        {card.imageThumb || card.imageDisplay || card.image ? (
                          <Image
                            source={{ uri: card.imageThumb || card.imageDisplay || card.image }}
                            cachePolicy="disk"
                            transition={150}
                            style={{ width: '100%', height: '100%' }}
                            contentFit="cover"
                          />
                        ) : null}
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={{ fontWeight: '700', fontSize: 16 }}>{card.name}</Text>
                      </View>
                      {asVerdict(card.verdict) ? (
                        <VerdictStamp verdict={asVerdict(card.verdict)!} size="sm" />
                      ) : null}
                    </View>
                  ))}
                </View>
              </ScrollView>
            ) : (
              <View style={{ paddingVertical: 24, alignItems: 'center' }}>
                <Text style={{ color: colors.ink500 }}>这一带还没有公开的味道</Text>
              </View>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  )
}
