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
import { Alert, Image } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { ActivityIndicator } from 'react-native'
import { ScrollView, Text, View, XStack, YStack } from 'tamagui'
import { deleteTaste, getTaste, type Taste } from '@yon/shared'
import { Badge, Button, Card, Icon, IconButton, Switch, VerdictStamp } from '@/components/ds'
import { useI18n } from '@/providers/I18nProvider'

export default function DetailView() {
  const { t } = useI18n()
  const router = useRouter()
  const params = useLocalSearchParams<{ id: string }>()
  const id = Array.isArray(params.id) ? params.id[0] : params.id

  const [item, setItem] = useState<Taste | null>(null)
  const [loading, setLoading] = useState(true)
  const [remind, setRemind] = useState(true)
  const [deleting, setDeleting] = useState(false)

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

  const doDelete = async () => {
    if (!item) return
    setDeleting(true)
    try {
      await deleteTaste(item.id)
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
          {item.image ? (
            <Image
              source={{ uri: item.image }}
              style={{ width: '100%', height: '100%' }}
              resizeMode="cover"
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
          <Button variant="secondary" iconLeft={<Icon name="edit" size={18} />}>
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
      </YStack>
    </ScrollView>
  )
}
