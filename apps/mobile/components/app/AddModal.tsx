/* ============================================================
   YUMMY OR NOT — AddModal (Tamagui / React Native + RN Web)
   Add / log a taste. RN port of the web AddModal: photo capture,
   name / place / price, verdict picker, tag chips, notes.

   Photo capture:
     - expo-image-picker — pick from library. The picked asset's
       { uri, name, type } is passed to createTaste() as an RNFile (multipart).
     - Compressed via expo-image-manipulator before upload.

   Same-name detection:
     - Debounces 500ms after typing stops in the "What?" field.
     - Min length: CJK ≥ 2 chars, latin ≥ 3 chars.
     - Runs searchTastes on the user's taste library (exact/strong only).
     - Shows an inline banner (never a modal): yellow for plain duplicate,
       red when the matching taste has warnBeforeBuy and warningsEnabled.
     - Tap banner to expand a list of matched records; tap row → detail.
     - X dismisses; dismissed prefixes are remembered for the session so
       the banner won't reshow for the same prefix.
     - warningsEnabled=false suppresses the red variant; yellow still shows.

   Presented as a full-screen sheet (the route layer decides whether
   that's a modal route on web or a stack screen on native).
   ============================================================ */

import { useEffect, useRef, useMemo, useState } from 'react'
import { Pressable, View } from 'react-native'
import {
  KeyboardAwareScrollView,
  KeyboardStickyView,
} from 'react-native-keyboard-controller'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated'
import * as ImagePicker from 'expo-image-picker'
import * as Location from 'expo-location'
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator'
import { Text, colors, space, radius } from '@/theme'
import {
  TAG_CHOICES,
  createTaste,
  createTag,
  reverseGeocode,
  searchTastes,
  type PhotoInput,
  type Taste,
  type TasteStatus,
  type Verdict,
} from '@yon/shared'

import {
  Button,
  Icon,
  IconButton,
  Input,
  Tag,
  Textarea,
  VerdictPicker,
  VerdictStamp,
} from '@/components/ds'

import { useI18n } from '@/providers/I18nProvider'
import { useAuth } from '@/providers/AuthProvider'
import { invalidateTastes, useRefreshableTastes } from '@/app/(tabs)/_useTastes'
import { invalidateTagsCache, useTags } from '@/app/(tabs)/_useTags'
import { PhotoPreview } from './PhotoPreview'
import { useRouter } from 'expo-router'

interface Props {
  onClose: () => void
  /** Called after a successful save. Receives the created taste id so the
   *  route layer can navigate to its detail. */
  onSaved: (id: string) => void
}

const KICKER = {
  color: colors.ink700,
  fontSize: 11,
  letterSpacing: 1.32,
  textTransform: 'uppercase' as const,
}

/** Pull a sane filename + mime type off a picked native asset. */
function rnFileFromAsset(asset: ImagePicker.ImagePickerAsset): PhotoInput {
  const type = asset.mimeType ?? 'image/jpeg'
  const name =
    asset.fileName ?? `photo.${type.includes('png') ? 'png' : 'jpg'}`
  return { uri: asset.uri, name, type }
}

/**
 * Compress and resize a native image asset before upload.
 * - Downscales to max 1600px wide (preserves aspect ratio; never upscales).
 * - Re-encodes as JPEG at quality 0.7.
 * Returns a new PhotoInput with the compressed uri and type 'image/jpeg'.
 * Falls back to the original asset on any error so the upload can still proceed.
 * expo-image-manipulator supports both native and web.
 */
async function compressAsset(asset: ImagePicker.ImagePickerAsset): Promise<PhotoInput> {
  try {
    const MAX_WIDTH = 2560
    // Only add a resize action when the image actually exceeds the limit (never upscale).
    const actions = asset.width && asset.width > MAX_WIDTH
      ? [{ resize: { width: MAX_WIDTH } }]
      : []
    const result = await manipulateAsync(asset.uri, actions, {
      format: SaveFormat.JPEG,
      compress: 0.85,
    })
    const name = asset.fileName
      ? asset.fileName.replace(/\.[^.]+$/, '.jpg')
      : 'photo.jpg'
    return { uri: result.uri, name, type: 'image/jpeg' }
  } catch {
    // If compression fails for any reason, fall back to the original to avoid blocking the upload.
    return rnFileFromAsset(asset)
  }
}

/**
 * Returns true when the query is long enough to trigger same-name detection.
 * CJK characters count as a word each; latin needs at least 3 chars total.
 */
function queryMeetsMinLength(q: string): boolean {
  if (!q) return false
  // Count CJK characters in the string.
  const cjkCount = (q.match(/[一-鿿㐀-䶿가-힯぀-ヿ]/g) ?? []).length
  if (cjkCount >= 2) return true
  return q.trim().length >= 3
}

/** Stable session-scoped set of dismissed query prefixes. */
const dismissedPrefixes = new Set<string>()

/** Normalised lowercase prefix used as the dismiss key. */
function dismissKey(q: string): string {
  return q.trim().toLowerCase()
}

export default function AddModal({ onClose, onSaved }: Props) {
  const { t } = useI18n()
  const { user } = useAuth()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { tags: userTags } = useTags()
  const { items } = useRefreshableTastes()

  // Merge the user's tag library with the built-in TAG_CHOICES, deduped, for
  // the chip list. Built-in choices always appear first so the UX stays stable
  // even before the tag fetch completes (userTags starts as []).
  const tagChoices = useMemo(() => {
    const builtIn = TAG_CHOICES as readonly string[]
    const extra = userTags.map((t) => t.name).filter((n) => !builtIn.includes(n))
    return [...builtIn, ...extra]
  }, [userTags])

  // Mode: 'tasted' (default) shows VerdictPicker; 'todo' hides it.
  const [mode, setMode] = useState<TasteStatus>('tasted')


  const [name, setName] = useState('')
  const [place, setPlace] = useState('')
  const [price, setPrice] = useState('')
  const [notes, setNotes] = useState('')
  const [verdict, setVerdict] = useState<Verdict | null>(null)
  const [picked, setPicked] = useState<string[]>([])
  const [customTag, setCustomTag] = useState('')
  const [lat, setLat] = useState<number | null>(null)
  const [lng, setLng] = useState<number | null>(null)
  const [locationDenied, setLocationDenied] = useState(false)
  const [locating, setLocating] = useState(false)
  const [locRecorded, setLocRecorded] = useState(false)
  const [locFailed, setLocFailed] = useState(false)

  // `photo` is the value handed to createTaste (RNFile on native, File on web).
  const [photo, setPhoto] = useState<PhotoInput | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)

  // Measured height of the sticky action footer. The footer floats up over the
  // scroll viewport when the keyboard opens (KeyboardStickyView), so the scroll
  // view's bottomOffset must reserve footer height + a 16dp margin — otherwise a
  // focused bottom field (notes / custom tag) sits BEHIND the floating footer.
  // Seed with an estimate (button row + paddings + safe-area inset) so the very
  // first focus before onLayout fires still clears the footer; the real measured
  // height replaces it on layout.
  const [footerHeight, setFooterHeight] = useState(64 + insets.bottom)

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // --- Same-name detection -----------------------------------------------

  // Debounced query value used for duplicate detection. Updated 500ms after
  // name changes stop so we don't hammer searchTastes on every keystroke.
  const [debouncedName, setDebouncedName] = useState('')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pickInFlight = useRef(false)

  const handleNameChange = (text: string) => {
    setName(text)
    // Clear any existing banner dismissal tracking when the name changes
    // substantially (the user is typing something new).
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setDebouncedName(text)
    }, 500)
  }

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  // Whether the banner has been dismissed for the current debouncedName prefix.
  const [bannerDismissed, setBannerDismissed] = useState(false)

  // Reset dismissal state when the debounced query changes to a new prefix
  // that is not covered by any session-dismissed prefix. A dismissed prefix
  // suppresses the banner for all extensions of that prefix (e.g. dismissing
  // "珍珠" also suppresses "珍珠奶茶").
  useEffect(() => {
    if (!debouncedName) {
      setBannerDismissed(false)
      return
    }
    const key = dismissKey(debouncedName)
    const covered = Array.from(dismissedPrefixes).some((p) => key.startsWith(p))
    setBannerDismissed(covered)
  }, [debouncedName])

  // Expanded state: whether the duplicate rows list is shown.
  const [bannerExpanded, setBannerExpanded] = useState(false)

  // Compute duplicate matches (exact/strong only) using the debounced name.
  const dupMatches = useMemo<Taste[]>(() => {
    if (!queryMeetsMinLength(debouncedName)) return []
    const results = searchTastes(items, debouncedName)
    return results
      .filter((r) => r.strength === 'exact' || r.strength === 'strong')
      .map((r) => r.item)
  }, [items, debouncedName])

  const warningsOn = user?.warningsEnabled ?? false

  // Determine banner variant:
  //   'warn' — at least one match has warnBeforeBuy AND warningsEnabled AND mode=tasted
  //   'dup'  — plain duplicate (any match), no warn condition
  //   null   — no banner
  // In todo mode the red warn variant is hidden (yellow dup banner stays).
  const bannerVariant = useMemo<'warn' | 'dup' | null>(() => {
    if (dupMatches.length === 0) return null
    if (mode === 'tasted' && warningsOn && dupMatches.some((m) => m.warnBeforeBuy)) return 'warn'
    return 'dup'
  }, [dupMatches, warningsOn, mode])

  const showBanner = bannerVariant !== null && !bannerDismissed

  const dismissBanner = () => {
    const key = dismissKey(debouncedName)
    dismissedPrefixes.add(key)
    setBannerDismissed(true)
    setBannerExpanded(false)
  }

  // --- Tag helpers --------------------------------------------------------

  const toggle = (tg: string) =>
    setPicked((p) => (p.includes(tg) ? p.filter((x) => x !== tg) : [...p, tg]))

  const addCustomTag = () => {
    const tag = customTag.trim()
    if (!tag) {
      setCustomTag('')
      return
    }
    setPicked((p) => (p.includes(tag) ? p : [...p, tag]))
    setCustomTag('')
  }

  // --- Native photo capture ------------------------------------------------
  const pickFromLibrary = async () => {
    if (pickInFlight.current) return
    pickInFlight.current = true
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync()
      if (!perm.granted) {
        setError(t('photo_permission_denied'))
        return
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        quality: 1,
      })
      if (!result.canceled && result.assets[0]) {
        const asset = result.assets[0]
        setPhotoPreview(asset.uri)
        setPhoto(await compressAsset(asset))
      }
    } finally {
      pickInFlight.current = false
    }
  }

  const fillPlaceFromAddress = (address: Location.LocationGeocodedAddress | null | undefined) => {
    if (!address) return
    const line1 = [address.name, address.street].filter(Boolean).join(' ')
    const line2 = [address.city ?? address.district, address.region].filter(Boolean).join(', ')
    const nextPlace = [line1, line2].filter(Boolean).join(' · ')
    if (nextPlace) setPlace(nextPlace)
  }

  const locateMe = async () => {
    if (locating) return
    setLocating(true)
    setLat(null)
    setLng(null)
    setLocRecorded(false)
    setLocFailed(false)
    let permission: { granted: boolean }
    try {
      permission = await Location.requestForegroundPermissionsAsync()
    } catch {
      setLocationDenied(true)
      setLocating(false)
      return
    }
    if (!permission.granted) {
      setLocationDenied(true)
      setLocating(false)
      return
    }
    setLocationDenied(false)
    try {
      // Early-out when location services are disabled at the OS level — no
      // point waiting 15s for a fix that can never arrive.
      const servicesEnabled = await Location.hasServicesEnabledAsync()
      if (!servicesEnabled) {
        setLocFailed(true)
        setLocating(false)
        return
      }

      // Acquire a fix from the most reliable source available. On a fresh build
      // / cold GPS, getCurrentPositionAsync can stall well past 10s and was the
      // sole driver of the "定位失败" banner. So we try sources in order and only
      // fail when EVERY source comes up empty:
      //   1. Last-known position — instant when the OS has a recent cached fix
      //      (≤5min old). Covers the common "I was just using maps" case.
      //   2. A fresh getCurrentPositionAsync, raced against a 15s timeout.
      // If (2) throws/times out but (1) gave us coords, we keep (1)'s coords —
      // a stale-but-real fix beats showing 定位失败.
      let coords: Location.LocationObject['coords'] | null = null

      try {
        const lastKnown = await Location.getLastKnownPositionAsync({
          maxAge: 5 * 60 * 1000,
        })
        if (lastKnown) coords = lastKnown.coords
      } catch {
        // Last-known lookup failed — fall through to a fresh fix below.
      }

      try {
        // Race getCurrentPositionAsync against a 15s timeout. Clear the timer
        // once the race settles so it never lingers (a pending timer keeps the
        // event loop alive and, after the race resolves, its reject becomes an
        // unhandled rejection).
        const positionPromise = Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
        })
        let timeoutId: ReturnType<typeof setTimeout> | undefined
        const timeoutPromise = new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error('location_timeout')), 15_000)
        })
        try {
          const current = await Promise.race([positionPromise, timeoutPromise])
          coords = current.coords
        } finally {
          if (timeoutId) clearTimeout(timeoutId)
        }
      } catch {
        // Fresh fix failed/timed out — keep last-known coords if we have them.
      }

      // No source produced a fix → this is the only path that fails.
      if (!coords) throw new Error('location_unavailable')

      const nextLat = coords.latitude
      const nextLng = coords.longitude
      setLat(nextLat)
      setLng(nextLng)
      setLocRecorded(true)

      // Try native geocode first; fall back to server if empty. A reverse-geocode
      // failure must NOT show 定位失败 — coords are recorded and usable; the place
      // field just stays editable.
      let geocoded = false
      try {
        const results = await Location.reverseGeocodeAsync({
          latitude: nextLat,
          longitude: nextLng,
        })
        if (results.length > 0 && results[0]) {
          fillPlaceFromAddress(results[0])
          geocoded = true
        }
      } catch {
        // Native geocode failed — try server fallback below.
      }

      if (!geocoded) {
        try {
          const { place } = await reverseGeocode(nextLat, nextLng)
          if (place) setPlace(place)
        } catch {
          // Server fallback failed — coords are still recorded, place stays editable.
        }
      }
    } catch (err) {
      // Silent degrade: save path must still work without location.
      setLat(null)
      setLng(null)
      setLocFailed(true)
    } finally {
      setLocating(false)
    }
  }

  const ready = !!name && (mode === 'todo' || !!verdict)

  const handleSave = async () => {
    if (!ready || saving) return
    if (mode === 'tasted' && !verdict) return
    setSaving(true)
    setError(null)
    try {
      const created = await createTaste(
        {
          name,
          place: place || undefined,
          price: price || undefined,
          status: mode,
          verdict: mode === 'todo' ? undefined : verdict === null ? undefined : verdict,
          tags: picked.length ? picked : undefined,
          notes: notes || undefined,
          lat,
          lng,
        },
        photo,
      )
      void invalidateTastes()

      // Upsert any custom tags (tags not in the built-in TAG_CHOICES) into the
      // user's tag candidate set so they appear in LibraryView's filter chips.
      // Fire-and-forget: a failure here must not block navigation.
      const customTags = picked.filter(
        (tg) => !(TAG_CHOICES as readonly string[]).includes(tg),
      )
      if (customTags.length > 0) {
        void Promise.all(customTags.map((tg) => createTag({ name: tg }))).then(
          () => invalidateTagsCache(),
        )
      }

      onSaved(created.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
      setSaving(false)
    }
  }

  // --- Banner colours ------------------------------------------------------
  const bannerBg = bannerVariant === 'warn' ? colors.verdictNah : colors.verdictMeh
  const bannerBorder = bannerVariant === 'warn' ? colors.verdictNah2 : colors.ink900
  const bannerIcon = bannerVariant === 'warn' ? 'alert' : 'info-box'

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {/* sticky header */}
      <View
        testID="add-modal-header"
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: space[5],
          paddingTop: insets.top + 16,
          paddingBottom: space[4],
          borderBottomWidth: 3,
          borderBottomColor: colors.ink900,
        }}
      >
        <Text style={{ color: colors.ink900, fontWeight: '700', fontSize: 24 }}>
          {t('log_taste')}
        </Text>
        <IconButton accessibilityLabel={t('cancel')} onPress={onClose}>
          <Icon name="close" size={18} />
        </IconButton>
      </View>

      {/* scrollable body — KeyboardAwareScrollView keeps the focused input and
          its cursor visible above the keyboard with a frame-synced animation
          (no one-frame jump). It subsumes the old RN KeyboardAvoidingView +
          manual scrollToEnd-on-focus compensation.

          The sticky footer floats up over the viewport with the keyboard
          (KeyboardStickyView), so the scroll content must physically reserve
          its height in TWO places or a focused bottom field sits behind it:
            - contentContainerStyle.paddingBottom = footerHeight + 16 reserves
              the resting inset so the last field can always scroll fully clear
              of the floated footer (the bug was a hardcoded 24dp here);
            - bottomOffset = footerHeight + 16 drives the focus auto-scroll so a
              newly-focused bottom field lands above the footer, not behind it. */}
      <KeyboardAwareScrollView
        bottomOffset={footerHeight + 16}
        style={{ flex: 1 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        contentContainerStyle={{ padding: 20, gap: 20, paddingBottom: footerHeight + 16 }}
      >
        {/* mode selector — 吃过了 / 还没吃，先记下 */}
        <View
          style={{
            flexDirection: 'row',
            borderWidth: 2,
            borderColor: colors.ink900,
            borderRadius: radius.md,
            overflow: 'hidden',
          }}
          testID="add-mode-selector"
        >
          <Pressable
            style={{ flex: 1, paddingVertical: 10, alignItems: 'center', backgroundColor: mode === 'tasted' ? colors.ink900 : colors.paper2 }}
            onPress={() => setMode('tasted')}
            accessibilityRole="button"
          >
            <Text
              style={{ color: mode === 'tasted' ? '#fff' : colors.ink900, fontWeight: '600', fontSize: 14 }}
            >
              {t('add_mode_tasted')}
            </Text>
          </Pressable>
          <View style={{ width: 2, backgroundColor: colors.ink900 }} />
          <Pressable
            style={{ flex: 1, paddingVertical: 10, alignItems: 'center', backgroundColor: mode === 'todo' ? colors.ink900 : colors.paper2 }}
            onPress={() => setMode('todo')}
            accessibilityRole="button"
            testID="add-mode-todo-btn"
          >
            <Text
              style={{ color: mode === 'todo' ? '#fff' : colors.ink900, fontWeight: '600', fontSize: 14 }}
            >
              {t('add_mode_todo')}
            </Text>
          </Pressable>
        </View>

        {/* photo + basic fields */}
        <View style={{ gap: space[4] }}>
          {/* photo dropzone */}
          <Pressable
            onPress={() => void pickFromLibrary()}
            accessibilityRole="button"
            accessibilityLabel={t('add_photo')}
            style={{
              height: 160,
              alignItems: 'center',
              justifyContent: 'center',
              gap: space[2],
              borderWidth: 3,
              borderColor: colors.ink900,
              borderRadius: radius.md,
              backgroundColor: colors.paper2,
              overflow: 'hidden',
            }}
          >
            {photoPreview ? (
              <PhotoPreview uri={photoPreview} />
            ) : (
              <>
                <Icon name="camera" size={32} color="#a89fae" />
                <Text
                  style={{ color: colors.ink500, fontSize: 9, letterSpacing: 1.1, textTransform: 'uppercase' }}
                >
                  {t('add_photo')}
                </Text>
              </>
            )}
          </Pressable>

          {/* text fields */}
          <Input
            label={t('f_what')}
            placeholder="Brown sugar boba"
            value={name}
            onChangeText={handleNameChange}
          />

          {/* inline same-name detection banner */}
          {showBanner ? (
            <Animated.View
              entering={FadeIn.duration(200)}
              exiting={FadeOut.duration(150)}
            >
              <View
                testID="dup-banner"
                style={{
                  borderWidth: 2,
                  borderColor: bannerBorder,
                  borderRadius: radius.md,
                  backgroundColor: bannerBg,
                  overflow: 'hidden',
                }}
              >
                {/* banner header row — non-pressable container with two independent
                    press targets to avoid nested Pressable propagation issues */}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2], paddingLeft: 12, paddingRight: 4, paddingVertical: 12 }}>
                  {/* expand/collapse tappable area — fills the row except the close button */}
                  <Pressable
                    style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: space[2] }}
                    onPress={() => setBannerExpanded((e) => !e)}
                    accessibilityRole="button"
                  >
                    <Icon name={bannerIcon} size={18} color="#191017" />
                    <Text style={{ flex: 1, color: colors.ink900, fontSize: 14, fontWeight: '600' }}>
                      {t(bannerVariant === 'warn' ? 'add_warn_hint' : 'add_duplicate_hint')}
                    </Text>
                    <Icon
                      name={bannerExpanded ? 'chevron-up' : 'chevron-down'}
                      size={16}
                      color="#191017"
                    />
                  </Pressable>
                  {/* close button — separate Pressable so it doesn't bubble into the expand handler */}
                  <Pressable
                    onPress={dismissBanner}
                    accessibilityRole="button"
                    accessibilityLabel={t('cancel')}
                    style={{ padding: 4 }}
                  >
                    <Icon name="close" size={14} color="#191017" />
                  </Pressable>
                </View>

                {/* expanded match rows */}
                {bannerExpanded ? (
                  <View style={{ borderTopWidth: 2, borderTopColor: bannerBorder }}>
                    {dupMatches.map((match) => (
                      <Pressable
                        key={match.id}
                        style={{ flexDirection: 'row', alignItems: 'center', gap: space[3], padding: 12, borderTopWidth: 1, borderTopColor: colors.ink200 }}
                        onPress={() => {
                          onClose()
                          router.push(`/taste/${match.id}`)
                        }}
                        accessibilityRole="button"
                      >
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={{ color: colors.ink900, fontWeight: '600', fontSize: 14 }}>
                            {match.name}
                          </Text>
                          {match.place ? (
                            <Text style={{ color: colors.ink500, fontSize: 12 }}>
                              {match.place}
                            </Text>
                          ) : null}
                        </View>
                        {match.verdict != null ? (
                          <VerdictStamp verdict={match.verdict} size="sm" label={t('v_' + match.verdict)} />
                        ) : null}
                      </Pressable>
                    ))}
                  </View>
                ) : null}
              </View>
            </Animated.View>
          ) : null}

          <View style={{ gap: space[2] }}>
            <Input
              label={t('f_where')}
              placeholder="Tiger Sugar · Hongdae"
              value={place}
              onChangeText={setPlace}
            />
            {user?.locationEnabled && !locationDenied ? (
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  onPress={locateMe}
                  testID="locate-button"
                  iconLeft={<Icon name="map" size={16} color="#191017" />}
                >
                  {locating ? t('loc_locating') : t('loc_use_location')}
                </Button>
                {locRecorded && !locating ? (
                  <Text testID="loc-recorded-marker" style={{ fontSize: 12, color: '#4caf50' }}>
                    {'✓ ' + t('loc_recorded')}
                  </Text>
                ) : null}
                {locFailed && !locating ? (
                  <Text testID="loc-failed-hint" style={{ fontSize: 12, color: '#888' }}>
                    {t('loc_failed')}
                  </Text>
                ) : null}
              </>
            ) : null}
          </View>
          <Input
            label={t('f_price')}
            placeholder="$5.80"
            value={price}
            onChangeText={setPrice}
            keyboardType="decimal-pad"
          />
        </View>

        {/* verdict picker — hidden in todo mode */}
        {mode === 'tasted' ? (
          <View style={{ gap: space[2] }}>
            <Text style={KICKER}>{t('how_was_it')}</Text>
            <VerdictPicker
              value={verdict}
              onChange={setVerdict}
              labels={{ yum: t('v_yum'), meh: t('v_meh'), nah: t('v_nah') }}
            />
          </View>
        ) : null}

        {/* tag chips */}
        <View style={{ gap: space[2] }}>
          <Text style={KICKER}>{t('tags')}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
            {tagChoices.map((tg) => (
              <Tag key={tg} active={picked.includes(tg)} onPress={() => toggle(tg)}>
                {tg}
              </Tag>
            ))}
            {picked
              .filter((tg) => !tagChoices.includes(tg))
              .map((tg) => (
                <Tag
                  key={tg}
                  active
                  onPress={() => toggle(tg)}
                  onRemove={() => toggle(tg)}
                >
                  {tg}
                </Tag>
              ))}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
            <View style={{ flex: 1 }}>
              <Input
                placeholder={t('add_tag')}
                value={customTag}
                onChangeText={setCustomTag}
                onSubmitEditing={addCustomTag}
                returnKeyType="done"
              />
            </View>
            <Button variant="secondary" size="md" onPress={addCustomTag}>
              {t('add_tag')}
            </Button>
          </View>
        </View>

        {/* notes */}
        <Textarea
          label={t('your_take')}
          placeholder="Too sweet, but the texture was perfect…"
          numberOfLines={3}
          value={notes}
          onChangeText={setNotes}
        />

        {error ? (
          <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(150)}>
            <Text style={{ color: colors.verdictNah2, fontSize: 14 }}>
              {error}
            </Text>
          </Animated.View>
        ) : null}

      </KeyboardAwareScrollView>

      {/* sticky footer — actions row pinned outside the scroll. KeyboardStickyView
          translates it up WITH the keyboard (frame-synced) so the save row stays
          pinned just above the keyboard instead of being hidden behind it. The
          footer's own paddingBottom (safe-area bottom inset + 16) is the resting
          gap when the keyboard is closed; when it opens, the view rides the
          keyboard top and that padding becomes the gap above the keys. */}
      <KeyboardStickyView>
        <View
          testID="add-actions-footer"
          onLayout={(e) => setFooterHeight(e.nativeEvent.layout.height)}
          style={{
            flexDirection: 'row',
            justifyContent: 'flex-end',
            gap: space[3],
            backgroundColor: colors.background,
            borderTopWidth: 3,
            borderTopColor: colors.ink900,
            paddingHorizontal: space[5],
            paddingTop: space[4],
            paddingBottom: insets.bottom + 16,
          }}
        >
          <Button variant="ghost" onPress={onClose}>
            {t('cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={!ready || saving}
            iconLeft={<Icon name="check" size={18} color="#fff" />}
            onPress={handleSave}
          >
            {t('save_taste_web')}
          </Button>
        </View>
      </KeyboardStickyView>
    </View>
  )
}
