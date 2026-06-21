/* ============================================================
   YUMMY OR NOT — LocationPinRow

   The "定位地址" (physical pin) editor row, shared by AddModal (create) and
   DetailView (edit). It sits BELOW the place-nickname input and edits the
   lat/lng pin independently of the name: a status line ("精确定位已设置 / 未设置"),
   an Android-only "在地图上选点" button that opens the AMap LocationPicker, and a
   clear action once a pin exists.

   PLATFORM: point-on-map is Android-only (the AMap SDK is Android-native), so
   the open button only renders on Android. The status + clear affordance render
   everywhere, so a pin set on Android is still visible/removable on web/iOS.
   ============================================================ */

import { Platform, Pressable, View } from 'react-native'

import { Button, Icon } from '@/components/ds'
import { useI18n } from '@/providers/I18nProvider'
import { colors, space, Text } from '@/theme'

export interface LocationPinRowProps {
  lat: number | null
  lng: number | null
  /** Open the map point-picker (Android). */
  onOpenPicker: () => void
  /** Clear the physical pin (keeps the place nickname). */
  onClear: () => void
}

export default function LocationPinRow({ lat, lng, onOpenPicker, onClear }: LocationPinRowProps) {
  const { t } = useI18n()
  const hasPin = lat != null && lng != null
  const isAndroid = Platform.OS === 'android'

  return (
    <View style={{ gap: space[2] }} testID="location-pin-row">
      <Text style={{ color: colors.ink700, fontSize: 11, letterSpacing: 1.32, textTransform: 'uppercase' }}>
        {t('loc_pin_label')}
      </Text>

      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[2] }}>
        <Text
          testID="location-pin-status"
          style={{ flex: 1, fontSize: 13, color: hasPin ? '#4caf50' : colors.ink400 }}
        >
          {hasPin
            ? `✓ ${t('loc_pin_set')} (${lat!.toFixed(5)}, ${lng!.toFixed(5)})`
            : t('loc_pin_none')}
        </Text>
        {hasPin ? (
          <Pressable testID="location-pin-clear" onPress={onClear} hitSlop={8}>
            <Text style={{ fontSize: 13, color: colors.ink500, textDecorationLine: 'underline' }}>
              {t('loc_pin_clear')}
            </Text>
          </Pressable>
        ) : null}
      </View>

      {isAndroid ? (
        <Button
          variant="secondary"
          size="sm"
          onPress={onOpenPicker}
          testID="location-pin-open"
          iconLeft={<Icon name="map" size={16} color={colors.ink900} />}
        >
          {hasPin ? t('loc_pin_change') : t('loc_pick_on_map')}
        </Button>
      ) : null}
    </View>
  )
}
