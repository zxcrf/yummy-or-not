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
import { useLocateResult } from '@/app/(tabs)/_useUserCoords'
import {
  decideHeatFetch,
  heatColorForCount,
  regionToBbox,
  summarizeVerdicts,
  type Bbox,
} from '@/lib/heatView'
import { Badge, Button, Card, Icon, Tag, VerdictStamp } from '@/components/ds'
import { colors, space, radius, Text } from '@/theme'

const CONSENT_KEY = 'yon_amap_consent'
const DEBOUNCE_MS = 300

// Shanghai People's Square — the fallback center when we have no GPS fix
// (permission denied / services off / timeout). WGS-84; converted to GCJ-02
// before it ever reaches AMap.
const FALLBACK = {
  latitude: 31.2304,
  longitude: 121.4737,
}
// Zoom that lands inside decideHeatFetch's allowed bbox (so heat loads on entry
// without first nagging "放大查看").
const ENTRY_ZOOM = 15

/**
 * Build the AMap initial camera (GCJ-02) for entry. With a GPS fix we center on
 * the user; otherwise we center on the FALLBACK city. The input is WGS-84 (GPS
 * / our default), so we ALWAYS convert via wgs84ToGcj02 — AMap is GCJ-02, and
 * skipping the conversion would offset the center by ~hundreds of metres in
 * China. Returns the camera plus whether it reflects a real user fix.
 */
export function initialCameraFromCoords(coords: { lat: number; lng: number } | null) {
  const src = coords ?? { lat: FALLBACK.latitude, lng: FALLBACK.longitude }
  const g = wgs84ToGcj02(src.lat, src.lng)
  return {
    centered: coords != null,
    camera: { target: { latitude: g.lat, longitude: g.lng }, zoom: ENTRY_ZOOM },
  }
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

  // Default-locate on entry: only request the fix AFTER consent (so the OS
  // location prompt never precedes the AMap privacy gate). We hold the map
  // mount until the locate is settled (got a fix, or failed/denied) so the
  // INITIAL camera reflects the user's position instead of snapping later.
  const locate = useLocateResult(consent === true)

  // Selected-cell bottom sheet.
  const [sheetCell, setSheetCell] = useState<string | null>(null)
  const [sheetCards, setSheetCards] = useState<GeoFeedCard[] | null>(null)
  const [sheetLoading, setSheetLoading] = useState(false)
  // Tapped card → coarsened detail sub-sheet (still no precise coord / identity).
  const [detailCard, setDetailCard] = useState<GeoFeedCard | null>(null)

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
    setDetailCard(null)
  }, [])

  const closeDetail = useCallback(() => setDetailCard(null), [])

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

  // Camera is computed from the settled locate result. While locating we keep
  // it null (we don't mount the map yet — see below) so the very first frame is
  // already centered on the user and never jumps from the fallback city.
  const initial = useMemo(
    () => initialCameraFromCoords(locate.coords),
    [locate.coords],
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

  // --- Locating (consent granted, waiting for the GPS fix) ---
  // Hold the map mount until the locate settles so the first frame is already
  // centered on the user (no fallback-city → user jump).
  if (locate.status === 'locating') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.ink900} />
        <Text style={{ marginTop: space[3], color: colors.ink500, fontSize: 13 }}>定位中…</Text>
      </View>
    )
  }

  // --- Map (consent granted, SDK initialized, locate settled) ---
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <MapView
        style={{ flex: 1 }}
        initialCameraPosition={initial.camera}
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

      {/* Locate fell back to the default city — say so explicitly (don't show a
          wrong place silently). Non-blocking; the map is still usable. */}
      {!initial.centered ? (
        <View
          testID="nearby-fallback-notice"
          pointerEvents="none"
          style={{
            position: 'absolute',
            bottom: space[4],
            alignSelf: 'center',
            maxWidth: '88%',
            backgroundColor: colors.white,
            borderWidth: 2,
            borderColor: colors.ink900,
            borderRadius: radius.pill,
            paddingHorizontal: 14,
            paddingVertical: 8,
          }}
        >
          <Text style={{ fontWeight: '600', fontSize: 12, textAlign: 'center' }}>
            {locate.status === 'denied'
              ? '未授权定位，已显示默认城市'
              : '定位失败，已显示默认城市'}
          </Text>
        </View>
      ) : null}

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
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: space[3] }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ fontWeight: '700', fontSize: 18 }}>这一带的味道</Text>
                {/* Aggregate verdict summary — pure counts, no per-record leak. */}
                {sheetCards && sheetCards.length > 0
                  ? (() => {
                      const s = summarizeVerdicts(sheetCards)
                      return (
                        <Text style={{ marginTop: 2, color: colors.ink500, fontSize: 13 }}>
                          {s.total} 个 · 👍{s.yum} 😐{s.meh} 👎{s.nah}
                        </Text>
                      )
                    })()
                  : null}
              </View>
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
                    <Pressable
                      key={card.id}
                      accessibilityRole="button"
                      accessibilityLabel={`查看 ${card.name} 详情`}
                      onPress={() => setDetailCard(card)}
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
                      <View style={{ flex: 1, minWidth: 0, gap: space[1] }}>
                        <Text style={{ fontWeight: '700', fontSize: 16 }}>{card.name}</Text>
                        {/* Safe meta row: repurchase counter + warn flag. */}
                        {card.boughtCount > 1 || card.warnBeforeBuy ? (
                          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[1] }}>
                            {card.boughtCount > 1 ? (
                              <Badge tone="dark">回购 {card.boughtCount}</Badge>
                            ) : null}
                            {card.warnBeforeBuy ? <Badge tone="nah">⚠️ 踩雷</Badge> : null}
                          </View>
                        ) : null}
                        {/* Category tags (bounded vocabulary — no PII). */}
                        {card.tags.length > 0 ? (
                          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[1] }}>
                            {card.tags.slice(0, 3).map((t) => (
                              <Tag key={t}>{t}</Tag>
                            ))}
                          </View>
                        ) : null}
                      </View>
                      {asVerdict(card.verdict) ? (
                        <VerdictStamp verdict={asVerdict(card.verdict)!} size="sm" />
                      ) : null}
                    </Pressable>
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

      {/* Card detail sub-sheet — a richer view of the SAME coarsened fields:
          big image + verdict + tags + repurchase + warn. NEVER precise coord,
          place, notes, or identity (those are not even on GeoFeedCard). */}
      <Modal visible={detailCard != null} transparent animationType="slide" onRequestClose={closeDetail}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }} onPress={closeDetail}>
          <Pressable
            style={{
              backgroundColor: '#fff',
              borderTopLeftRadius: 16,
              borderTopRightRadius: 16,
              padding: 20,
              paddingBottom: 36,
              maxHeight: '80%',
            }}
            onPress={() => {}}
          >
            {detailCard ? (
              <ScrollView>
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: space[3] }}>
                  <Text style={{ fontWeight: '700', fontSize: 20, flex: 1, minWidth: 0 }}>{detailCard.name}</Text>
                  <Pressable onPress={closeDetail} accessibilityRole="button" style={{ padding: 4 }}>
                    <Icon name="close" size={20} color={colors.ink500} />
                  </Pressable>
                </View>

                {detailCard.imageDisplay || detailCard.image || detailCard.imageThumb ? (
                  <View
                    style={{
                      width: '100%',
                      aspectRatio: 1,
                      borderRadius: radius.md,
                      borderWidth: 2,
                      borderColor: colors.ink900,
                      backgroundColor: colors.paper2,
                      overflow: 'hidden',
                      marginBottom: space[3],
                    }}
                  >
                    <Image
                      source={{ uri: detailCard.imageDisplay || detailCard.image || detailCard.imageThumb }}
                      cachePolicy="disk"
                      transition={150}
                      style={{ width: '100%', height: '100%' }}
                      contentFit="cover"
                    />
                  </View>
                ) : null}

                <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space[2], marginBottom: space[3] }}>
                  {asVerdict(detailCard.verdict) ? (
                    <VerdictStamp verdict={asVerdict(detailCard.verdict)!} size="md" />
                  ) : null}
                  {detailCard.boughtCount > 1 ? <Badge tone="dark">回购 {detailCard.boughtCount}</Badge> : null}
                  {detailCard.warnBeforeBuy ? <Badge tone="nah">⚠️ 踩雷</Badge> : null}
                </View>

                {detailCard.tags.length > 0 ? (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2], marginBottom: space[3] }}>
                    {detailCard.tags.map((t) => (
                      <Tag key={t}>{t}</Tag>
                    ))}
                  </View>
                ) : null}

                <Text style={{ color: colors.ink400, fontSize: 12, lineHeight: 18 }}>
                  仅展示公开分享的概要信息，不含精确位置与身份。
                </Text>
              </ScrollView>
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  )
}
