/* ============================================================
   YUMMY OR NOT — DetailView (Tamagui / React Native)
   Full record for one taste: photo, verdict stamp, name/price,
   tag badges, your-note card, a "warn me before I buy again" toggle,
   and edit/delete actions. Reads the id from the route, fetches the
   taste, and on delete calls deleteTaste then routes back. Ported from
   the web src/components/app/DetailView.tsx — the web drawer/overlay
   chrome is dropped; this renders as a routed screen body.
   ============================================================ */

import { useEffect, useState } from 'react'
import { Alert, Image, Modal, Pressable, StyleSheet } from 'react-native'
import { Image as ExpoImage } from 'expo-image'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { ActivityIndicator } from 'react-native'
import { ScrollView, Text, View, XStack, YStack } from 'tamagui'
import { deleteTaste, getTaste, getOriginalPhotoUrl, ProRequiredError, TAG_CHOICES, updateTaste, type Taste, type Verdict } from '@yon/shared'
import { invalidateTastes } from '@/app/(tabs)/_useTastes'
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
import { useAuth } from '@/providers/AuthProvider'
import { useI18n } from '@/providers/I18nProvider'

export default function DetailView() {
  const { t } = useI18n()
  const { user } = useAuth()
  const router = useRouter()
  const params = useLocalSearchParams<{ id: string }>()
  const id = Array.isArray(params.id) ? params.id[0] : params.id

  const [item, setItem] = useState<Taste | null>(null)
  const [loading, setLoading] = useState(true)
  const [remind, setRemind] = useState(true)
  const [deleting, setDeleting] = useState(false)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editPlace, setEditPlace] = useState('')
  const [editPrice, setEditPrice] = useState('')
  const [editNotes, setEditNotes] = useState('')
  const [editVerdict, setEditVerdict] = useState<Verdict>('yum')
  const [editTags, setEditTags] = useState<string[]>([])

  // Pro original viewer state.
  const [originalUrl, setOriginalUrl] = useState<string | null>(null)
  const [originalLoading, setOriginalLoading] = useState(false)

  useEffect(() => {
    if (!id) return
    let alive = true
    setLoading(true)
    getTaste(id)
      .then((data) => {
        if (alive) setItem(data)
      })
      .catch(() => {
        if (alive) setItem(null)
      })
      .finally(() => {
        if (alive) setLoading(false)
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
    setOriginalLoading(true)
    try {
      const { url } = await getOriginalPhotoUrl(item.id)
      setOriginalUrl(url)
    } catch (err) {
      if (err instanceof ProRequiredError) {
        // Surface the same upgrade prompt used elsewhere in the app.
        Alert.alert(t('pro_plan'), t('taste_limit_reached'))
      } else {
        Alert.alert(t('nothing_here'))
      }
    } finally {
      setOriginalLoading(false)
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
    Alert.alert(t('del'), t('confirm_delete'), [
      { text: t('cancel'), style: 'cancel' },
      { text: t('del'), style: 'destructive', onPress: doDelete },
    ])
  }

  const startEditing = () => {
    if (!item) return
    setEditName(item.name)
    setEditPlace(item.place)
    setEditPrice(item.price)
    setEditNotes(item.notes)
    setEditVerdict(item.verdict)
    setEditTags(item.tags)
    setSaveError(null)
    setEditing(true)
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
    setSaving(true)
    setSaveError(null)
    try {
      const updated = await updateTaste(item.id, {
        name: editName,
        place: editPlace,
        price: editPrice,
        verdict: editVerdict,
        tags: editTags,
        notes: editNotes,
      })
      setItem(updated)
      void invalidateTastes()
      setEditing(false)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <YStack flex={1} backgroundColor="$background" alignItems="center" justifyContent="center">
        <ActivityIndicator color="#191017" />
      </YStack>
    )
  }

  if (!item) {
    return (
      <YStack
        flex={1}
        backgroundColor="$background"
        alignItems="center"
        justifyContent="center"
        gap="$3"
        padding={24}
      >
        <Icon name="info-box" size={40} color="#b8aeb4" />
        <Text color="$ink500">{t('nothing_here')}</Text>
        <Button variant="secondary" onPress={goBack}>
          {t('cancel')}
        </Button>
      </YStack>
    )
  }

  return (
    <ScrollView
      flex={1}
      backgroundColor="$background"
      contentContainerStyle={{ paddingBottom: 40 }}
    >
      {/* photo + controls */}
      <View position="relative">
        <View
          height={240}
          backgroundColor="$paper2"
          borderBottomWidth={3}
          borderColor="$ink900"
          overflow="hidden"
        >
          {(item.imageDisplay || item.image) ? (
            <ExpoImage
              source={{
                uri: item.imageDisplay || item.image,
                ...(item.imageKey ? { cacheKey: `${item.imageKey}:display` } : {}),
              }}
              cachePolicy="disk"
              transition={150}
              style={{ width: '100%', height: '100%' }}
              contentFit="cover"
            />
          ) : null}
        </View>

        {/* back button */}
        <View position="absolute" top={16} left={16}>
          <IconButton aria-label={t('cancel')} onPress={goBack}>
            <Icon name="arrow-left" size={20} />
          </IconButton>
        </View>

        {/* verdict stamp */}
        <View position="absolute" left={18} bottom={-22}>
          <VerdictStamp
            verdict={item.verdict}
            size="lg"
            rotate={-5}
            label={t('v_' + item.verdict)}
          />
        </View>
      </View>

      {/* content */}
      <YStack padding={22} paddingTop={36} gap="$3">
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

            <YStack gap="$2">
              <Text color="$ink700" fontSize={11} letterSpacing={1.32} textTransform="uppercase">
                {t('how_was_it')}
              </Text>
              <VerdictPicker
                value={editVerdict}
                onChange={setEditVerdict}
                labels={{ yum: t('v_yum'), meh: t('v_meh'), nah: t('v_nah') }}
              />
            </YStack>

            <YStack gap="$2">
              <Text color="$ink700" fontSize={11} letterSpacing={1.32} textTransform="uppercase">
                {t('tags')}
              </Text>
              <XStack flexWrap="wrap" gap="$2">
                {TAG_CHOICES.map((tag) => (
                  <Tag key={tag} active={editTags.includes(tag)} onPress={() => toggleEditTag(tag)}>
                    {tag}
                  </Tag>
                ))}
              </XStack>
            </YStack>

            <Textarea
              label={t('your_take')}
              value={editNotes}
              onChangeText={setEditNotes}
              numberOfLines={3}
              placeholder="Too sweet, but the texture was perfect..."
            />

            {saveError ? (
              <Text color="$verdictNah2" fontSize={14}>
                {saveError}
              </Text>
            ) : null}

            <XStack gap="$3" marginTop="$1">
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
            </XStack>
          </>
        ) : (
          <>
            <XStack justifyContent="space-between" alignItems="flex-start" gap="$3">
              <YStack flex={1}>
                <Text color="$ink900" fontWeight="700" fontSize={24} lineHeight={26}>
                  {item.name}
                </Text>
                <Text color="$ink500" marginTop="$1">
                  {item.place}
                </Text>
              </YStack>
              {item.price ? (
                <Text color="$ink900" fontWeight="700" fontSize={26}>
                  {item.price}
                </Text>
              ) : null}
            </XStack>

            {/* badges */}
            <XStack gap="$2" flexWrap="wrap">
              <Badge tone="dark">{t('bought_n', { n: item.boughtCount })}</Badge>
              {item.tags.map((tg) => (
                <Badge key={tg}>{tg}</Badge>
              ))}
              {item.date ? <Badge>{item.date}</Badge> : null}
            </XStack>

            {/* note */}
            {item.notes ? (
              <Card padded>
                <Text
                  color="$ink400"
                  fontSize={10}
                  letterSpacing={1}
                  textTransform="uppercase"
                >
                  {t('your_note')}
                </Text>
                <Text color="$ink900" marginTop="$2" lineHeight={22}>
                  {item.notes}
                </Text>
              </Card>
            ) : null}

            {/* warn toggle */}
            <XStack alignItems="center" justifyContent="space-between" paddingVertical="$1">
              <XStack alignItems="center" gap="$3">
                <Icon name="alert" size={20} color="#ff5d8f" />
                <Text color="$ink900" fontWeight="500">
                  {t('warn_before')}
                </Text>
              </XStack>
              <Switch checked={remind} onChange={setRemind} />
            </XStack>

            {/* actions */}
            <XStack gap="$3" marginTop="$1">
              <Button variant="secondary" iconLeft={<Icon name="edit" size={18} />} onPress={startEditing}>
                {t('edit')}
              </Button>
              <Button
                variant="secondary"
                iconLeft={<Icon name="trash" size={18} />}
                disabled={deleting}
                onPress={handleDelete}
              >
                {t('del')}
              </Button>
            </XStack>

            {/* Pro original viewer */}
            {(item.imageDisplay || item.image) ? (
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
      </YStack>

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
    </ScrollView>
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
})
