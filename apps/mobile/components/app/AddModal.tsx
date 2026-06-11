/* ============================================================
   YUMMY OR NOT — AddModal (Tamagui / React Native + RN Web)
   Add / log a taste. RN port of the web AddModal: photo capture,
   name / place / price, verdict picker, tag chips, notes.

   Photo capture:
     - Native (iOS/Android): expo-image-picker — pick from library. The
       picked asset's { uri, name, type } is passed to createTaste() as an
       RNFile (multipart).
     - Web: a hidden <input type="file"> file picker; the browser File
       is passed straight to createTaste().

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
import { Platform } from 'react-native'
import {
  KeyboardAwareScrollView,
  KeyboardStickyView,
} from 'react-native-keyboard-controller'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated'
import * as ImagePicker from 'expo-image-picker'
import * as Location from 'expo-location'
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator'
import { Text, View, XStack, YStack } from 'tamagui'
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
  color: '$ink700',
  fontSize: 11,
  letterSpacing: 1.32,
  textTransform: 'uppercase',
} as const

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
  const fileInputRef = useRef<HTMLInputElement | null>(null)
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
  }

  // --- Web photo capture (hidden file input) -------------------------------
  const onWebFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null
    setPhoto(file)
    setPhotoPreview(file ? URL.createObjectURL(file) : null)
  }

  const onPhotoPress = () => {
    if (Platform.OS === 'web') {
      fileInputRef.current?.click()
    } else {
      void pickFromLibrary()
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
      // Race getCurrentPositionAsync against a 10s timeout.
      const positionPromise = Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      })
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('location_timeout')), 10_000),
      )
      const current = await Promise.race([positionPromise, timeoutPromise])
      const nextLat = current.coords.latitude
      const nextLng = current.coords.longitude
      setLat(nextLat)
      setLng(nextLng)
      setLocRecorded(true)

      // Try native geocode first; fall back to server if empty.
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
  const bannerBg = bannerVariant === 'warn' ? '$verdictNah' : '$verdictMeh'
  const bannerBorder = bannerVariant === 'warn' ? '$verdictNah2' : '$ink900'
  const bannerIcon = bannerVariant === 'warn' ? 'alert' : 'info-box'

  return (
    <View flex={1} backgroundColor="$background">
      {/* sticky header */}
      <View
        flexDirection="row"
        alignItems="center"
        justifyContent="space-between"
        paddingHorizontal="$5"
        paddingTop={insets.top + 16}
        paddingBottom="$4"
        borderBottomWidth={3}
        borderBottomColor="$ink900"
      >
        <Text color="$ink900" fontWeight="700" fontSize={24}>
          {t('log_taste')}
        </Text>
        <IconButton aria-label={t('cancel')} onPress={onClose}>
          <Icon name="close" size={18} />
        </IconButton>
      </View>

      {/* scrollable body — KeyboardAwareScrollView keeps the focused input and
          its cursor visible above the keyboard with a frame-synced animation
          (no one-frame jump). bottomOffset reserves the sticky footer height +
          a 16dp margin: the footer floats up over the viewport with the keyboard
          (KeyboardStickyView), so clearing only the keyboard would leave a
          focused bottom field hidden behind it. It subsumes the old RN
          KeyboardAvoidingView + manual scrollToEnd-on-focus compensation. */}
      <KeyboardAwareScrollView
        bottomOffset={footerHeight + 16}
        style={{ flex: 1 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        contentContainerStyle={{ padding: 20, gap: 20, paddingBottom: 24 }}
      >
        {/* mode selector — 吃过了 / 还没吃，先记下 */}
        <XStack
          borderWidth={2}
          borderColor="$ink900"
          borderRadius="$md"
          overflow="hidden"
          testID="add-mode-selector"
        >
          <View
            flex={1}
            paddingVertical={10}
            alignItems="center"
            backgroundColor={mode === 'tasted' ? '$ink900' : '$paper2'}
            onPress={() => setMode('tasted')}
            accessibilityRole="button"
            cursor="pointer"
          >
            <Text
              color={mode === 'tasted' ? '#fff' : '$ink900'}
              fontWeight="600"
              fontSize={14}
            >
              {t('add_mode_tasted')}
            </Text>
          </View>
          <View
            width={2}
            backgroundColor="$ink900"
          />
          <View
            flex={1}
            paddingVertical={10}
            alignItems="center"
            backgroundColor={mode === 'todo' ? '$ink900' : '$paper2'}
            onPress={() => setMode('todo')}
            accessibilityRole="button"
            cursor="pointer"
            testID="add-mode-todo-btn"
          >
            <Text
              color={mode === 'todo' ? '#fff' : '$ink900'}
              fontWeight="600"
              fontSize={14}
            >
              {t('add_mode_todo')}
            </Text>
          </View>
        </XStack>

        {/* photo + basic fields */}
        <View gap="$4">
          {/* photo dropzone */}
          <View
            onPress={onPhotoPress}
            accessibilityRole="button"
            aria-label={t('add_photo')}
            height={160}
            alignItems="center"
            justifyContent="center"
            gap="$2"
            borderWidth={3}
            borderColor="$ink900"
            borderRadius="$md"
            backgroundColor="$paper2"
            overflow="hidden"
            cursor="pointer"
          >
            {photoPreview ? (
              <PhotoPreview uri={photoPreview} />
            ) : (
              <>
                <Icon name="camera" size={32} color="#a89fae" />
                <Text
                  color="$ink500"
                  fontSize={9}
                  letterSpacing={1.1}
                  textTransform="uppercase"
                >
                  {t('add_photo')}
                </Text>
              </>
            )}
          </View>

          {/* web-only: hidden native file input */}
          {Platform.OS === 'web' ? (
            <View height={0} overflow="hidden">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={onWebFileChange}
              />
            </View>
          ) : null}

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
                borderWidth={2}
                borderColor={bannerBorder}
                borderRadius="$md"
                backgroundColor={bannerBg}
                overflow="hidden"
              >
                {/* banner header row */}
                <XStack
                  alignItems="center"
                  gap="$2"
                  padding={12}
                  onPress={() => setBannerExpanded((e) => !e)}
                  cursor="pointer"
                  accessibilityRole="button"
                >
                  <Icon name={bannerIcon} size={18} color="#191017" />
                  <Text flex={1} color="$ink900" fontSize={14} fontWeight="600">
                    {t(bannerVariant === 'warn' ? 'add_warn_hint' : 'add_duplicate_hint')}
                  </Text>
                  <Icon
                    name={bannerExpanded ? 'chevron-up' : 'chevron-down'}
                    size={16}
                    color="#191017"
                  />
                  <View
                    onPress={dismissBanner}
                    accessibilityRole="button"
                    aria-label={t('cancel')}
                    padding={4}
                  >
                    <Icon name="close" size={14} color="#191017" />
                  </View>
                </XStack>

                {/* expanded match rows */}
                {bannerExpanded ? (
                  <YStack
                    borderTopWidth={2}
                    borderTopColor={bannerBorder}
                    gap={0}
                  >
                    {dupMatches.map((match) => (
                      <XStack
                        key={match.id}
                        alignItems="center"
                        gap="$3"
                        padding={12}
                        borderTopWidth={1}
                        borderTopColor="$ink200"
                        onPress={() => {
                          onClose()
                          router.push(`/taste/${match.id}`)
                        }}
                        cursor="pointer"
                        accessibilityRole="button"
                      >
                        <YStack flex={1} minWidth={0}>
                          <Text color="$ink900" fontWeight="600" fontSize={14}>
                            {match.name}
                          </Text>
                          {match.place ? (
                            <Text color="$ink500" fontSize={12}>
                              {match.place}
                            </Text>
                          ) : null}
                        </YStack>
                        {match.verdict != null ? (
                          <VerdictStamp verdict={match.verdict} size="sm" label={t('v_' + match.verdict)} />
                        ) : null}
                      </XStack>
                    ))}
                  </YStack>
                ) : null}
              </View>
            </Animated.View>
          ) : null}

          <View gap="$2">
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
          <View gap="$2">
            <Text {...KICKER}>{t('how_was_it')}</Text>
            <VerdictPicker
              value={verdict}
              onChange={setVerdict}
              labels={{ yum: t('v_yum'), meh: t('v_meh'), nah: t('v_nah') }}
            />
          </View>
        ) : null}

        {/* tag chips */}
        <View gap="$2">
          <Text {...KICKER}>{t('tags')}</Text>
          <View flexDirection="row" flexWrap="wrap" gap="$2">
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
          <View flexDirection="row" alignItems="center" gap="$2">
            <View flex={1}>
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
            <Text color="$verdictNah2" fontSize={14}>
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
          flexDirection="row"
          justifyContent="flex-end"
          gap="$3"
          borderTopWidth={3}
          borderTopColor="$ink900"
          paddingHorizontal="$5"
          paddingTop="$4"
          paddingBottom={insets.bottom + 16}
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
