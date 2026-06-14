/* ============================================================
   YUMMY OR NOT — DetailView (Tamagui / React Native)
   Full record for one taste: photo, verdict stamp, name/price,
   tag badges, your-note card, a "warn me before I buy again" toggle,
   and edit/delete actions. Reads the id from the route, fetches the
   taste, and on delete calls deleteTaste then routes back. Ported from
   the web src/components/app/DetailView.tsx — the web drawer/overlay
   chrome is dropped; this renders as a routed screen body.
   ============================================================ */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Image, Modal, Pressable, StyleSheet, View, View as RNView } from 'react-native'
import { KeyboardAwareScrollView, KeyboardStickyView } from 'react-native-keyboard-controller'
import { Image as ExpoImage } from 'expo-image'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { ActivityIndicator } from 'react-native'
import { colors, radius, space } from '@/theme'
import { Text } from '@/theme'
import { addPurchase, deleteTaste, getTaste, getOriginalPhotoUrl, mintShare, encodeShareToken, ProRequiredError, TAG_CHOICES, updateTaste, type Taste, type Verdict } from '@yon/shared'
import { captureRef } from 'react-native-view-shot'
import * as Sharing from 'expo-sharing'
import * as Clipboard from 'expo-clipboard'
import { getCachedTaste, invalidateTastes } from '@/app/(tabs)/_useTastes'
import { useTags } from '@/app/(tabs)/_useTags'
import {
  Badge,
  Button,
  Card,
  Icon,
  IconButton,
  Input,
  Switch,
  Tag,
  Textarea,
  VerdictPicker,
  VerdictStamp,
} from '@/components/ds'
import { ShareCard } from '@/components/app/ShareCard'
import { markShareCodeHandled } from '@/components/app/shareImportDedupe'
import { useAuth } from '@/providers/AuthProvider'
import { useI18n } from '@/providers/I18nProvider'

// S3a 可导入: build the https landing URL encoded as the card QR (识别图中二维码).
// `/i/<importCode>` mirrors the WeChat-forward fallback resolve path; the host
// is the API origin (EXPO_PUBLIC_API_URL, burned into the build). Empty host
// (web same-origin) still yields a usable relative `/i/<code>` for the QR.
const LANDING_HOST = (process.env.EXPO_PUBLIC_API_URL ?? '').replace(/\/$/, '')
function landingUrlForCode(importCode: string): string {
  return `${LANDING_HOST}/i/${importCode}`
}

export default function DetailView() {
  const { t, formatMoney } = useI18n()
  const { user } = useAuth()
  const router = useRouter()
  const params = useLocalSearchParams<{ id: string }>()
  const id = Array.isArray(params.id) ? params.id[0] : params.id

  const [renderedId, setRenderedId] = useState<string | undefined>(id)
  // Latest route id, for gating async completions (save / original-photo fetch /
  // metadata fallback) so a request started for one taste cannot commit onto
  // another after an id swap. Mirrored during render so the guard value is
  // commit-synchronous (a passive effect would leave a stale-ref gap).
  const idRef = useRef(id)
  idRef.current = id
  const [item, setItem] = useState<Taste | null>(() => (id ? getCachedTaste(id) ?? null : null))
  const [loading, setLoading] = useState<boolean>(() => !!id && getCachedTaste(id) == null)
  const [remind, setRemind] = useState(() => item?.warnBeforeBuy ?? false)
  const [deleting, setDeleting] = useState(false)
  const [buySheetOpen, setBuySheetOpen] = useState(false)
  const [buyPrice, setBuyPrice] = useState('')
  const [buyPlace, setBuyPlace] = useState('')
  const [buySubmitting, setBuySubmitting] = useState(false)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editPlace, setEditPlace] = useState('')
  const [editPrice, setEditPrice] = useState('')
  const [editNotes, setEditNotes] = useState('')
  const [editVerdict, setEditVerdict] = useState<Verdict>('yum')
  const [editTags, setEditTags] = useState<string[]>([])

  // Tag chip candidates: built-in choices first, then library extras, then the
  // item's own legacy tags not in either. Mirrors AddModal.tsx:153-157.
  const { tags: userTags } = useTags()
  const tagChoices = useMemo(() => {
    const builtIn = TAG_CHOICES as readonly string[]
    const extra = userTags.map((tg) => tg.name).filter((n) => !builtIn.includes(n))
    const itemLegacy = (item?.tags ?? []).filter(
      (n) => !builtIn.includes(n) && !extra.includes(n),
    )
    return [...builtIn, ...extra, ...itemLegacy]
  }, [userTags, item?.tags])

  // Delete confirm sheet state
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)

  // Promote sheet state (todo → tasted 转正)
  const [promoteSheetOpen, setPromoteSheetOpen] = useState(false)
  const [promoteVerdict, setPromoteVerdict] = useState<Verdict | null>(null)
  const [promotePrice, setPromotePrice] = useState('')
  const [promoteSubmitting, setPromoteSubmitting] = useState(false)

  // Pro original viewer state.
  const [originalUrl, setOriginalUrl] = useState<string | null>(null)
  const [originalLoading, setOriginalLoading] = useState(false)

  // Share card state — A1.
  const [sharing, setSharing] = useState(false)
  const [sharingAvailable, setSharingAvailable] = useState(false)
  // S3a: the import code to PRINT on the ShareCard for the importable-share
  // path (null for the plain S1 PNG share). Set before capture so the code
  // rides the captured PNG — the only channel that survives image-only
  // forwarding (WeChat strips the deep link from forwarded images).
  const [shareImportCode, setShareImportCode] = useState<string | null>(null)
  // S3a 可导入: the https landing URL (https://host/i/<code>) encoded as a QR on
  // the card in 可导入 mode. Null in pure-PNG mode → no QR / no scannable link.
  const [shareLandingUrl, setShareLandingUrl] = useState<string | null>(null)
  // The two-mode share picker (pure-PNG vs 可导入). Opened by the share-to-friend
  // button; the user explicitly picks which kind of share to produce.
  const [shareMenuOpen, setShareMenuOpen] = useState(false)
  const shareCardRef = useRef<RNView>(null)
  // Resolves the onReady race: set by handleShare, called by ShareCard.
  const shareReadyResolveRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    let alive = true
    Sharing.isAvailableAsync().then((v) => { if (alive) setSharingAvailable(v) }).catch(() => {})
    return () => { alive = false }
  }, [])

  // Same-instance route `id` change: re-seed from the shared cache synchronously
  // during render (React "adjust state on prop change" pattern) so we never paint
  // the previous taste for a commit before the passive effect runs. The lazy
  // useState initializers only run on first mount, so this covers id swaps.
  if (id !== renderedId) {
    setRenderedId(id)
    const cached = id ? getCachedTaste(id) ?? null : null
    setItem(cached)
    setLoading(!!id && !cached)
    // Drop any in-progress edit / original-photo state belonging to the previous
    // taste, otherwise a same-instance id swap could save taste A's edited fields
    // onto taste B (saveEdit patches the current item.id).
    setEditing(false)
    setSaving(false)
    setSaveError(null)
    setOriginalUrl(null)
    setOriginalLoading(false)
    setSharing(false)
    setShareImportCode(null)
    setShareLandingUrl(null)
    setShareMenuOpen(false)
    // Reset repurchase state so taste A's open sheet / typed inputs / remind value
    // don't bleed onto taste B before the data effect catches up.
    setRemind(cached?.warnBeforeBuy ?? false)
    setBuySheetOpen(false)
    setBuyPrice('')
    setBuyPlace('')
    setBuySubmitting(false)
    // Reset promote sheet state
    setPromoteSheetOpen(false)
    setPromoteVerdict(null)
    setPromotePrice('')
    setPromoteSubmitting(false)
    // Reset delete confirm sheet so an open dialog for taste A cannot delete taste B.
    setConfirmDeleteOpen(false)
  }

  useEffect(() => {
    if (!id) return
    // Warm list-cache hit: adopt the cached taste and stop loading. This also
    // covers the race where render saw a miss (loading=true) but the shared
    // list cache filled before this passive effect ran — without this we'd
    // strand on the spinner forever (DetailView doesn't subscribe to the cache).
    const cached = getCachedTaste(id)
    if (cached) {
      setItem(cached)
      setRemind(cached.warnBeforeBuy)
      setLoading(false)
      return
    }
    // Miss (deep-link / cold start): item=null, loading=true already set; fetch.
    // Gate on both the effect-local `alive` flag and the commit-synchronous
    // idRef so a fetch for an old id cannot paint onto a newer route in the
    // window before this effect's cleanup runs.
    let alive = true
    const fetchId = id
    getTaste(id)
      .then((data) => {
        if (alive && idRef.current === fetchId) {
          setItem(data)
          setRemind(data.warnBeforeBuy)
        }
      })
      .catch(() => {
        if (alive && idRef.current === fetchId) setItem(null)
      })
      .finally(() => {
        if (alive && idRef.current === fetchId) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [id])

  const goBack = () => {
    if (router.canGoBack()) router.back()
    else router.replace('/')
  }

  const openOriginal = async () => {
    if (!item) return
    const reqId = item.id
    setOriginalLoading(true)
    try {
      const { url } = await getOriginalPhotoUrl(item.id)
      // Route moved to another taste mid-fetch — don't open A's original on B.
      if (idRef.current !== reqId) return
      setOriginalUrl(url)
    } catch (err) {
      if (idRef.current !== reqId) return
      if (err instanceof ProRequiredError) {
        // Surface the same upgrade prompt used elsewhere in the app.
        Alert.alert(t('pro_plan'), t('taste_limit_reached'))
      } else {
        Alert.alert(t('nothing_here'))
      }
    } finally {
      if (idRef.current === reqId) setOriginalLoading(false)
    }
  }

  const doDelete = async () => {
    if (!item) return
    setDeleting(true)
    try {
      await deleteTaste(item.id)
      void invalidateTastes()
      goBack()
    } catch {
      setDeleting(false)
    }
  }

  const handleDelete = () => {
    setConfirmDeleteOpen(true)
  }

  const startEditing = () => {
    if (!item) return
    setEditName(item.name)
    setEditPlace(item.place)
    setEditPrice(item.price.replace(/[^0-9.]/g, ''))
    setEditNotes(item.notes)
    setEditVerdict(item.verdict ?? 'yum')
    setEditTags(item.tags)
    setSaveError(null)
    setEditing(true)
  }

  const openPromoteSheet = () => {
    if (!item) return
    setPromoteVerdict(null)
    setPromotePrice('')
    setPromoteSheetOpen(true)
  }

  const submitPromote = async () => {
    if (!item || !promoteVerdict || promoteSubmitting) return
    const promoteId = item.id
    const prevItem = item
    setPromoteSubmitting(true)
    // Optimistic flip: close sheet and show tasted state immediately.
    setItem({ ...item, status: 'tasted', verdict: promoteVerdict })
    setPromoteSheetOpen(false)
    try {
      const updated = await updateTaste(promoteId, {
        status: 'tasted',
        verdict: promoteVerdict,
        price: promotePrice || undefined,
      })
      void invalidateTastes()
      if (idRef.current !== promoteId) return
      setItem(updated)
    } catch (err) {
      if (idRef.current !== promoteId) return
      // Revert optimistic update on failure.
      setItem(prevItem)
      setPromoteSheetOpen(true)
      Alert.alert(err instanceof Error ? err.message : 'Save failed')
    } finally {
      if (idRef.current === promoteId) setPromoteSubmitting(false)
    }
  }

  const cancelEditing = () => {
    setSaveError(null)
    setSaving(false)
    setEditing(false)
  }

  const toggleEditTag = (tag: string) => {
    setEditTags((tags) =>
      tags.includes(tag) ? tags.filter((t) => t !== tag) : [...tags, tag],
    )
  }

  const saveEdit = async () => {
    if (!item || !editName || saving) return
    const savingId = item.id
    setSaving(true)
    setSaveError(null)
    try {
      const updated = await updateTaste(item.id, {
        name: editName,
        place: editPlace,
        price: editPrice,
        // Todo rows carry no verdict (rating is hidden while editing a todo and
        // only set when promoting), so don't write one here.
        ...(item.status === 'todo' ? {} : { verdict: editVerdict }),
        tags: editTags,
        notes: editNotes,
      })
      // The server write to `savingId` happened — refresh the list regardless.
      void invalidateTastes()
      // But if the route moved to another taste mid-save, do NOT paint A's
      // updated record onto B (and don't touch B's edit/saving state).
      if (idRef.current !== savingId) return
      setItem(updated)
      setEditing(false)
    } catch (err) {
      if (idRef.current !== savingId) return
      setSaveError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      if (idRef.current === savingId) setSaving(false)
    }
  }

  const toggleRemind = async (next: boolean) => {
    if (!item) return
    const prev = remind
    const toggleId = item.id
    setRemind(next)
    setItem((p) => (p ? { ...p, warnBeforeBuy: next } : p))
    try {
      await updateTaste(item.id, { warnBeforeBuy: next })
      // The server write happened — refresh the list regardless of route state.
      void invalidateTastes()
    } catch {
      // Only revert if the route hasn't moved to a different taste; otherwise
      // we'd clobber B's remind/item state with A's stale previous value.
      if (idRef.current !== toggleId) return
      setRemind(prev)
      setItem((p) => (p ? { ...p, warnBeforeBuy: prev } : p))
    }
  }

  const openBuySheet = () => {
    if (!item) return
    const lastPurchase = item.purchases[0]
    setBuyPrice(lastPurchase?.price ?? item.price)
    setBuyPlace(lastPurchase?.place ?? item.place)
    setBuySheetOpen(true)
  }

  // Start the ShareCard readiness race: wait for the image onLoad callback
  // (onReady) against a 600 ms timeout fallback (no-photo / disk-cached thumb).
  // Returned synchronously so the timer is scheduled in the SAME tick as the
  // button press, even when the caller awaits other work (mintShare) first.
  const waitForShareCardReady = (): Promise<void> =>
    Promise.race([
      new Promise<void>((resolve) => {
        shareReadyResolveRef.current = resolve
      }),
      new Promise<void>((resolve) => setTimeout(resolve, 600)),
    ])

  // Capture the off-screen ShareCard to a PNG and hand it to the system share
  // sheet. When `extraText` is set (importable share) it rides in the share
  // sheet alongside the PNG so the recipient gets the deep link + import code
  // (S3a). The owner's presigned photo URL is never in the payload — only the
  // rendered PNG file URI travels. `ready` lets the caller pre-start the race.
  const captureAndShare = async (ready: Promise<void>, extraText?: string) => {
    if (!item) return
    const captureId = item.id
    await ready
    shareReadyResolveRef.current = null

    // Guard: nav moved to a different taste while we waited — abort silently.
    if (idRef.current !== captureId) return
    const uri = await captureRef(shareCardRef, { format: 'png', quality: 1, result: 'tmpfile' })
    if (idRef.current !== captureId) return
    await Sharing.shareAsync(uri, {
      mimeType: 'image/png',
      // extraText (deep link + code) is offered to share targets that accept a
      // subject/text alongside the image. It is BEST-EFFORT only: WeChat strips
      // it from forwarded images, so it is NOT the delivery channel for the
      // import code. The code is PRINTED on the captured PNG itself (see
      // handleImportableShare → shareImportCode → ShareCard) so it always
      // reaches the recipient regardless of how the image is forwarded.
      ...(extraText ? { dialogTitle: extraText } : {}),
    })
  }

  // ── Pure-PNG share mode ──────────────────────────────────────────────────
  // The original behavior: capture the off-screen ShareCard → share the PNG.
  // NO token is minted, NOTHING is written to the clipboard, and the card stays
  // link-free (no importCode, no QR / landing URL). A pure image must never
  // carry a scannable link or a copyable 口令 — that is the privacy contract of
  // this mode.
  const handleSharePng = async () => {
    if (!item || sharing) return
    setShareMenuOpen(false)
    setSharing(true)
    setShareImportCode(null)
    setShareLandingUrl(null)
    const ready = waitForShareCardReady()
    try {
      await captureAndShare(ready)
    } catch {
      Alert.alert(t('share_failed'))
    } finally {
      // Always reset sharing — idRef guard only gates the shareAsync call,
      // not the state reset, so the button is always re-enabled after this.
      setSharing(false)
      setShareImportCode(null)
      setShareLandingUrl(null)
    }
  }

  // ── 可导入 (淘口令) share mode ────────────────────────────────────────────
  // Mint a thin token, then deliver the importCode through THREE channels so it
  // reaches the recipient no matter how the share is forwarded:
  //   1. a collision-resistant 口令 (encodeShareToken) written to the clipboard
  //      (expo-clipboard) — the app auto-detects it on the recipient's next
  //      foreground (useShareTokenImport);
  //   2. the same 口令 + deep link in the system share text;
  //   3. the importCode PRINTED on the PNG + a QR encoding the https landing URL
  //      (识别图中二维码) — the channels that survive image-only forwarding (WeChat
  //      strips the deep link and share text from forwarded images).
  const handleShareImportable = async () => {
    if (!item || sharing) return
    const shareId = item.id
    setShareMenuOpen(false)
    setSharing(true)
    // Start the readiness race synchronously (same tick as the press) so its
    // 600ms fallback timer is scheduled before we await mintShare — matching
    // handleSharePng's timing.
    const ready = waitForShareCardReady()
    try {
      const { deepLink, importCode } = await mintShare(item.id)
      if (idRef.current !== shareId) return
      // Print the code + render the QR on the card BEFORE capture so the
      // captured PNG carries both (the channels that survive image-only
      // forwarding). React commits this re-render synchronously, so they are on
      // the card by capture time.
      setShareImportCode(importCode)
      setShareLandingUrl(landingUrlForCode(importCode))
      // The collision-resistant 口令 wraps the EXISTING importCode (no new code
      // space) and is what the recipient's foreground auto-detect parses back
      // out. We compute it now so it can ride the share text, but we DON'T write
      // it to the sender's own clipboard until the share actually completes —
      // see below.
      const passphrase = encodeShareToken(importCode)
      // Plain text (not via t() interpolation) so the link/口令 survive verbatim.
      const text = `${t('share_import_intro')}\n${deepLink}\n${t('share_import_code_label')} ${importCode}\n${passphrase}`
      await captureAndShare(ready, text)
      // Only NOW write the 口令 to the clipboard. If the user cancelled the
      // system share sheet (or captureAndShare threw), we never reach here, so
      // the sender's token does NOT leak into their own clipboard — which would
      // otherwise auto-import on their next foreground even though nothing was
      // actually shared.
      await Clipboard.setStringAsync(passphrase)
      // Self-import guard: this device now holds its OWN 口令 in the clipboard.
      // Mark the importCode handled so the foreground auto-detect
      // (useShareTokenImport) never prompts the SENDER to import their own
      // share — copy-on-import would otherwise duplicate their own taste (the
      // import API has no server-side self guard). Same marker the recipient
      // dedupe uses, keyed on the importCode the 口令 parses back to.
      await markShareCodeHandled(importCode)
    } catch {
      Alert.alert(t('share_failed'))
    } finally {
      setSharing(false)
      setShareImportCode(null)
      setShareLandingUrl(null)
    }
  }

  const onShareCardReady = () => {
    shareReadyResolveRef.current?.()
  }

  const submitBuy = async () => {
    if (!item || buySubmitting) return
    const submitId = item.id
    setBuySubmitting(true)
    // Optimistic boughtCount bump
    setItem((prev) => prev ? { ...prev, boughtCount: prev.boughtCount + 1 } : prev)
    try {
      const { purchase, boughtCount } = await addPurchase(item.id, {
        price: buyPrice || null,
        place: buyPlace || null,
      })
      if (idRef.current === submitId) {
        setItem((prev) =>
          prev
            ? { ...prev, boughtCount, purchases: [purchase, ...prev.purchases] }
            : prev,
        )
      }
      void invalidateTastes()
      setBuySheetOpen(false)
    } catch {
      // Revert optimistic bump
      if (idRef.current === submitId) {
        setItem((prev) => prev ? { ...prev, boughtCount: prev.boughtCount - 1 } : prev)
      }
    } finally {
      if (idRef.current === submitId) setBuySubmitting(false)
    }
  }

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={colors.ink900} />
      </View>
    )
  }

  if (!item) {
    return (
      <View
        style={{ flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', gap: space[3], padding: 24 }}
      >
        <Icon name="info-box" size={40} color={colors.ink300} />
        <Text style={{ color: colors.ink500 }}>{t('nothing_here')}</Text>
        <Button variant="secondary" onPress={goBack}>
          {t('cancel')}
        </Button>
      </View>
    )
  }

  return (
    <KeyboardAwareScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ paddingBottom: 40 }}
      bottomOffset={16}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
    >
      {/* photo + controls */}
      <View style={{ position: 'relative' }}>
        <View
          style={{
            height: 240,
            backgroundColor: colors.paper2,
            borderBottomWidth: 3,
            borderColor: colors.ink900,
            overflow: 'hidden',
          }}
        >
          {(item.imageThumb || item.image) ? (
            <ExpoImage
              source={{
                uri: item.imageThumb || item.image,
                ...(item.imageKey ? { cacheKey: `${item.imageKey}:thumb` } : {}),
              }}
              cachePolicy="disk"
              transition={150}
              style={{ width: '100%', height: '100%' }}
              contentFit="cover"
            />
          ) : null}
        </View>

        {/* back button */}
        <View style={{ position: 'absolute', top: 16, left: 16 }}>
          <IconButton accessibilityLabel={t('cancel')} onPress={goBack}>
            <Icon name="arrow-left" size={20} />
          </IconButton>
        </View>

        {/* verdict stamp — hidden for todo items */}
        {item.status !== 'todo' && item.verdict != null ? (
          <View style={{ position: 'absolute', left: 18, bottom: -22 }}>
            <VerdictStamp
              verdict={item.verdict}
              size="lg"
              rotate={-5}
              label={t('v_' + item.verdict)}
            />
          </View>
        ) : null}
      </View>

      {/* content */}
      <View style={{ padding: 22, paddingTop: 36, gap: space[3] }}>
        {editing ? (
          <>
            <Input
              label={t('f_what')}
              value={editName}
              onChangeText={setEditName}
              placeholder="Brown sugar boba"
            />
            <Input
              label={t('f_where')}
              value={editPlace}
              onChangeText={setEditPlace}
              placeholder="Tiger Sugar · Hongdae"
            />
            <Input
              label={t('f_price')}
              value={editPrice}
              onChangeText={setEditPrice}
              placeholder="$5.80"
            />

            {/* rating section — hidden for todo items (they haven't been eaten
                yet, so there's nothing to rate; matches AddModal todo mode).
                Promotion to tasted happens via the dedicated promote sheet. */}
            {item.status !== 'todo' ? (
              <View style={{ gap: space[2] }}>
                <Text style={{ color: colors.ink700, fontSize: 11, letterSpacing: 1.32, textTransform: 'uppercase' }}>
                  {t('how_was_it')}
                </Text>
                <VerdictPicker
                  value={editVerdict}
                  onChange={setEditVerdict}
                  labels={{ yum: t('v_yum'), meh: t('v_meh'), nah: t('v_nah') }}
                />
              </View>
            ) : null}

            <View style={{ gap: space[2] }}>
              <Text style={{ color: colors.ink700, fontSize: 11, letterSpacing: 1.32, textTransform: 'uppercase' }}>
                {t('tags')}
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
                {tagChoices.map((tag) => (
                  <Tag key={tag} active={editTags.includes(tag)} onPress={() => toggleEditTag(tag)}>
                    {tag}
                  </Tag>
                ))}
              </View>
            </View>

            <Textarea
              label={t('your_take')}
              value={editNotes}
              onChangeText={setEditNotes}
              numberOfLines={3}
              placeholder="Too sweet, but the texture was perfect..."
            />

            {saveError ? (
              <Text style={{ color: colors.verdictNah2, fontSize: 14 }}>
                {saveError}
              </Text>
            ) : null}

            <View
              testID="edit-actions-footer"
              style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: space[3], marginTop: space[1] }}
            >
              <Button variant="ghost" onPress={cancelEditing}>
                {t('cancel')}
              </Button>
              <Button
                variant="primary"
                disabled={!editName || saving}
                iconLeft={<Icon name="check" size={18} color="#fff" />}
                onPress={saveEdit}
              >
                {t('save_taste_web')}
              </Button>
            </View>
          </>
        ) : (
          <>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: space[3] }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.ink900, fontWeight: '700', fontSize: 24, lineHeight: 26 }}>
                  {item.name}
                </Text>
                <Text style={{ color: colors.ink500, marginTop: space[1] }}>
                  {item.place}
                </Text>
              </View>
              {item.price ? (
                <Text style={{ color: colors.ink900, fontWeight: '700', fontSize: 26 }}>
                  {formatMoney(item.price)}
                </Text>
              ) : null}
            </View>

            {/* badges — purchase count hidden for todo items (never bought;
                boughtCount is structurally 1+purchases so a todo reads 1). */}
            <View style={{ flexDirection: 'row', gap: space[2], flexWrap: 'wrap' }}>
              {item.status !== 'todo' ? (
                <Badge tone="dark">{t('bought_n', { n: item.boughtCount })}</Badge>
              ) : null}
              {item.tags.map((tg) => (
                <Badge key={tg}>{tg}</Badge>
              ))}
              {item.date ? <Badge>{item.date}</Badge> : null}
            </View>

            {/* note */}
            {item.notes ? (
              <Card padded>
                <Text
                  style={{ color: colors.ink400, fontSize: 10, letterSpacing: 1, textTransform: 'uppercase' }}
                >
                  {t('your_note')}
                </Text>
                <Text style={{ color: colors.ink900, marginTop: space[2], lineHeight: 22 }}>
                  {item.notes}
                </Text>
              </Card>
            ) : null}

            {/* warn toggle — hidden for todo items */}
            {item.status !== 'todo' ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: space[1] }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[3] }}>
                  <Icon name="alert" size={20} color="#ff5d8f" />
                  <Text style={{ color: colors.ink900, fontWeight: '500' }}>
                    {t('warn_before')}
                  </Text>
                </View>
                <Switch checked={remind} onChange={toggleRemind} />
              </View>
            ) : null}

            {/* warn banner — shown when warnBeforeBuy is on and global warnings enabled (tasted only) */}
            {item.status !== 'todo' && remind && user?.warningsEnabled ? (
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: space[2],
                  backgroundColor: colors.candyYellow,
                  borderWidth: 2,
                  borderColor: colors.ink900,
                  borderRadius: radius.sm,
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                }}
                testID="warn-banner"
              >
                <Icon name="alert" size={16} color={colors.ink900} />
                <Text style={{ color: colors.ink900, fontSize: 13, flex: 1 }}>
                  {t('detail_warn_banner')}
                </Text>
              </View>
            ) : null}

            {/* promote CTA — only for todo items */}
            {item.status === 'todo' ? (
              <Button
                variant="primary"
                iconLeft={<Icon name="check" size={18} color="#fff" />}
                onPress={openPromoteSheet}
                testID="promote-btn"
              >
                {t('promote_cta')}
              </Button>
            ) : null}

            {/* actions */}
            <View style={{ flexDirection: 'row', gap: space[3], marginTop: space[1], flexWrap: 'wrap' }}>
              <Button variant="secondary" iconLeft={<Icon name="edit" size={18} />} onPress={startEditing}>
                {t('edit')}
              </Button>
              <Button
                variant="secondary"
                iconLeft={<Icon name="trash" size={18} />}
                disabled={deleting}
                onPress={handleDelete}
                testID="delete-btn"
              >
                {t('del')}
              </Button>
              {/* buy-again hidden for todo items */}
              {item.status !== 'todo' ? (
                <Button
                  variant="secondary"
                  iconLeft={<Icon name="check" size={18} />}
                  onPress={openBuySheet}
                  testID="buy-again-btn"
                >
                  {t('detail_buy_again')}
                </Button>
              ) : null}
              {/* S3a — share to a friend: opens a picker for the TWO modes
                  (仅图片 / 可导入). The old top-level "分享" button was removed —
                  it was a duplicate of 仅图片（无链接）(both call handleSharePng). */}
              {item.status !== 'todo' && sharingAvailable ? (
                <Button
                  variant="secondary"
                  iconLeft={<Icon name="arrow-right" size={18} />}
                  disabled={sharing}
                  onPress={() => setShareMenuOpen((open) => !open)}
                  testID="share-import-btn"
                >
                  {t('share_to_friend')}
                </Button>
              ) : null}

              {/* The two explicit share modes (revealed by share-import-btn):
                  • pure-PNG  — image only, link-free, nothing copied.
                  • 可导入     — mints a token, copies the 口令, prints code + QR. */}
              {shareMenuOpen && item.status !== 'todo' && sharingAvailable ? (
                <>
                  <Button
                    variant="ghost"
                    iconLeft={<Icon name="image" size={18} />}
                    disabled={sharing}
                    onPress={handleSharePng}
                    testID="share-mode-png"
                  >
                    {t('share_mode_png')}
                  </Button>
                  <Button
                    variant="ghost"
                    iconLeft={<Icon name="arrow-right" size={18} />}
                    disabled={sharing}
                    onPress={handleShareImportable}
                    testID="share-mode-importable"
                  >
                    {t('share_mode_importable')}
                  </Button>
                </>
              ) : null}
            </View>

            {/* Off-screen ShareCard mount for capture — A1 */}
            {sharing && item ? (
              <RNView
                style={{ position: 'absolute', left: -9999, top: 0 }}
                collapsable={false}
                pointerEvents="none"
              >
                <ShareCard
                  ref={shareCardRef}
                  taste={item}
                  verdictLabel={t('v_' + (item.verdict ?? 'yum'))}
                  brandText={t('share_brand_tag')}
                  priceText={item.price ? formatMoney(item.price) : ''}
                  importCode={shareImportCode ?? undefined}
                  importCodeHint={shareImportCode ? t('share_card_import_hint') : undefined}
                  landingUrl={shareLandingUrl ?? undefined}
                  onReady={onShareCardReady}
                />
              </RNView>
            ) : null}

            {/* Pro original viewer */}
            {(item.imageThumb || item.image) ? (
              user?.plan === 'pro' ? (
                <Button
                  variant="secondary"
                  iconLeft={<Icon name="image" size={18} />}
                  disabled={originalLoading}
                  onPress={openOriginal}
                >
                  {t('view_original')}
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  iconLeft={<Icon name="image" size={18} />}
                  onPress={() => Alert.alert(t('pro_plan'), t('taste_limit_reached'))}
                >
                  {t('view_original_pro')}
                </Button>
              )
            ) : null}
          </>
        )}
      </View>

      {/* +1 Again sheet */}
      <Modal
        visible={buySheetOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setBuySheetOpen(false)}
      >
        <Pressable style={styles.sheetOverlay} onPress={() => setBuySheetOpen(false)}>
          {/* KeyboardStickyView rides the sheet up with the keyboard so the
              price/place inputs and the confirm row stay above it instead of
              being hidden behind it (matches AddModal / TagManageView). */}
          <KeyboardStickyView>
          <Pressable style={styles.sheetContent} onPress={() => {}}>
            <Text style={{ color: colors.ink900, fontWeight: '700', fontSize: 18, marginBottom: 16 }}>
              {t('detail_buy_again_title')}
            </Text>
            {item.warnBeforeBuy && user?.warningsEnabled ? (
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: space[2],
                  backgroundColor: colors.candyYellow,
                  borderWidth: 2,
                  borderColor: colors.ink900,
                  borderRadius: radius.sm,
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  marginBottom: 12,
                }}
                testID="buy-sheet-warn-banner"
              >
                <Icon name="alert" size={16} color={colors.ink900} />
                <Text style={{ color: colors.ink900, fontSize: 13, flex: 1 }}>
                  {t('detail_warn_banner')}
                </Text>
              </View>
            ) : null}
            <Input
              label={t('f_price')}
              value={buyPrice}
              onChangeText={setBuyPrice}
              placeholder="5.80"
              testID="buy-price-input"
            />
            <View style={{ marginTop: 12 }}>
              <Input
                label={t('f_where')}
                value={buyPlace}
                onChangeText={setBuyPlace}
                placeholder="Tiger Sugar · Hongdae"
                testID="buy-place-input"
              />
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: space[3], marginTop: 20 }}>
              <Button variant="ghost" onPress={() => setBuySheetOpen(false)}>
                {t('cancel')}
              </Button>
              <Button
                variant="primary"
                disabled={buySubmitting}
                iconLeft={<Icon name="check" size={18} color="#fff" />}
                onPress={submitBuy}
                testID="buy-confirm-btn"
              >
                {t('detail_buy_again_confirm')}
              </Button>
            </View>
          </Pressable>
          </KeyboardStickyView>
        </Pressable>
      </Modal>

      {/* Delete confirm sheet — replaces native Alert.alert */}
      <Modal
        visible={confirmDeleteOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setConfirmDeleteOpen(false)}
        testID="confirm-delete-modal"
      >
        <Pressable style={styles.sheetOverlay} onPress={() => setConfirmDeleteOpen(false)}>
          <Pressable style={styles.sheetContent} onPress={() => {}}>
            <Text style={{ color: colors.ink900, fontWeight: '700', fontSize: 18, marginBottom: 8 }}>
              {t('del')}
            </Text>
            <Text style={{ color: colors.ink500, fontSize: 15, marginBottom: 20 }}>
              {t('confirm_delete')}
            </Text>
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: space[3] }}>
              <Button variant="ghost" onPress={() => setConfirmDeleteOpen(false)}>
                {t('cancel')}
              </Button>
              <Button
                variant="primary"
                style={{ backgroundColor: '#ff3147' }}
                disabled={deleting}
                onPress={() => { setConfirmDeleteOpen(false); void doDelete() }}
                testID="confirm-delete-btn"
              >
                {t('del')}
              </Button>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Promote sheet — 转正: todo → tasted */}
      <Modal
        visible={promoteSheetOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setPromoteSheetOpen(false)}
      >
        <Pressable style={styles.sheetOverlay} onPress={() => setPromoteSheetOpen(false)}>
          {/* KeyboardStickyView rides the sheet up with the keyboard so the
              price input and confirm row stay above it (see buy sheet above). */}
          <KeyboardStickyView>
          <Pressable style={styles.sheetContent} onPress={() => {}}>
            <Text style={{ color: colors.ink900, fontWeight: '700', fontSize: 18, marginBottom: 16 }}>
              {t('promote_title')}
            </Text>
            <VerdictPicker
              value={promoteVerdict}
              onChange={setPromoteVerdict}
              labels={{ yum: t('v_yum'), meh: t('v_meh'), nah: t('v_nah') }}
              staticRender
            />
            <View style={{ marginTop: 12 }}>
              <Input
                label={t('f_price')}
                value={promotePrice}
                onChangeText={setPromotePrice}
                placeholder="5.80"
                testID="promote-price-input"
              />
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: space[3], marginTop: 20 }}>
              <Button variant="ghost" onPress={() => setPromoteSheetOpen(false)}>
                {t('cancel')}
              </Button>
              <Button
                variant="primary"
                disabled={!promoteVerdict || promoteSubmitting}
                iconLeft={<Icon name="check" size={18} color="#fff" />}
                onPress={submitPromote}
                testID="promote-confirm-btn"
              >
                {t('promote_confirm')}
              </Button>
            </View>
          </Pressable>
          </KeyboardStickyView>
        </Pressable>
      </Modal>

      {/* Fullscreen original image modal */}
      <Modal
        visible={!!originalUrl}
        transparent
        animationType="fade"
        onRequestClose={() => setOriginalUrl(null)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setOriginalUrl(null)}>
          {originalUrl ? (
            <Image
              source={{ uri: originalUrl }}
              style={styles.modalImage}
              resizeMode="contain"
            />
          ) : null}
        </Pressable>
      </Modal>
    </KeyboardAwareScrollView>
  )
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalImage: {
    width: '100%',
    height: '100%',
  },
  sheetOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheetContent: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 24,
    paddingBottom: 40,
  },
})
