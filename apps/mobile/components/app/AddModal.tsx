/* ============================================================
   YUMMY OR NOT — AddModal (Tamagui / React Native + RN Web)
   Add / log a taste. RN port of the web AddModal: photo capture,
   name / place / price, verdict picker, tag chips, notes.

   Photo capture:
     - Native (iOS/Android): expo-image-picker — pick from library OR
       take a photo with the camera. The picked asset's { uri, name,
       type } is passed to createTaste() as an RNFile (multipart).
     - Web: a hidden <input type="file"> file picker; the browser File
       is passed straight to createTaste().

   Presented as a full-screen sheet (the route layer decides whether
   that's a modal route on web or a stack screen on native).
   ============================================================ */

import { useRef, useState } from 'react'
import { KeyboardAvoidingView, Platform } from 'react-native'
import * as ImagePicker from 'expo-image-picker'
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator'
import { ScrollView, Text, View } from 'tamagui'
import { TAG_CHOICES, createTaste, type PhotoInput, type Verdict } from '@yon/shared'

import {
  Button,
  Icon,
  IconButton,
  Input,
  Tag,
  Textarea,
  VerdictPicker,
} from '@/components/ds'

import { useI18n } from '@/providers/I18nProvider'
import { PhotoPreview } from './PhotoPreview'

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
    const MAX_WIDTH = 1600
    // Only add a resize action when the image actually exceeds the limit (never upscale).
    const actions = asset.width && asset.width > MAX_WIDTH
      ? [{ resize: { width: MAX_WIDTH } }]
      : []
    const result = await manipulateAsync(asset.uri, actions, {
      format: SaveFormat.JPEG,
      compress: 0.7,
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

export default function AddModal({ onClose, onSaved }: Props) {
  const { t } = useI18n()
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const [name, setName] = useState('')
  const [place, setPlace] = useState('')
  const [price, setPrice] = useState('')
  const [notes, setNotes] = useState('')
  const [verdict, setVerdict] = useState<Verdict | null>(null)
  const [picked, setPicked] = useState<string[]>([])

  // `photo` is the value handed to createTaste (RNFile on native, File on web).
  const [photo, setPhoto] = useState<PhotoInput | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const toggle = (tg: string) =>
    setPicked((p) => (p.includes(tg) ? p.filter((x) => x !== tg) : [...p, tg]))

  // --- Native photo capture ------------------------------------------------
  const pickFromLibrary = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!perm.granted) {
      setError(t('add_photo'))
      return
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      quality: 0.8,
    })
    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0]
      setPhotoPreview(asset.uri)
      setPhoto(await compressAsset(asset))
    }
  }

  const takePhoto = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync()
    if (!perm.granted) {
      setError(t('add_photo'))
      return
    }
    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      quality: 0.8,
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
      // Native: offer camera; library is the common path so default to it.
      // takePhoto() is wired to the secondary affordance below.
      void pickFromLibrary()
    }
  }

  const ready = !!name && !!verdict

  const handleSave = async () => {
    if (!ready || !verdict) return
    setSaving(true)
    setError(null)
    try {
      const created = await createTaste(
        {
          name,
          place: place || undefined,
          price: price || undefined,
          verdict,
          tags: picked.length ? picked : undefined,
          notes: notes || undefined,
        },
        photo,
      )
      onSaved(created.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
      setSaving(false)
    }
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
    <View flex={1} backgroundColor="$background">
      {/* sticky header */}
      <View
        flexDirection="row"
        alignItems="center"
        justifyContent="space-between"
        paddingHorizontal="$5"
        paddingVertical="$4"
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

      {/* scrollable body */}
      <ScrollView flex={1} keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, gap: 20 }}>
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

          {/* native-only: explicit "take a photo" affordance */}
          {Platform.OS !== 'web' ? (
            <Button
              variant="secondary"
              size="sm"
              iconLeft={<Icon name="camera" size={16} />}
              onPress={takePhoto}
            >
              {t('add_photo')}
            </Button>
          ) : null}

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
            onChangeText={setName}
          />
          <Input
            label={t('f_where')}
            placeholder="Tiger Sugar · Hongdae"
            value={place}
            onChangeText={setPlace}
          />
          <Input
            label={t('f_price')}
            placeholder="$5.80"
            value={price}
            onChangeText={setPrice}
          />
        </View>

        {/* verdict picker */}
        <View gap="$2">
          <Text {...KICKER}>{t('how_was_it')}</Text>
          <VerdictPicker
            value={verdict}
            onChange={setVerdict}
            labels={{ yum: t('v_yum'), meh: t('v_meh'), nah: t('v_nah') }}
          />
        </View>

        {/* tag chips */}
        <View gap="$2">
          <Text {...KICKER}>{t('tags')}</Text>
          <View flexDirection="row" flexWrap="wrap" gap="$2">
            {TAG_CHOICES.map((tg) => (
              <Tag key={tg} active={picked.includes(tg)} onPress={() => toggle(tg)}>
                {tg}
              </Tag>
            ))}
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
          <Text color="$verdictNah2" fontSize={14}>
            {error}
          </Text>
        ) : null}

        {/* actions */}
        <View
          flexDirection="row"
          justifyContent="flex-end"
          gap="$3"
          paddingTop="$2"
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
      </ScrollView>
    </View>
    </KeyboardAvoidingView>
  )
}
