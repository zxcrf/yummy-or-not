/* ============================================================
   YUMMY OR NOT — YouView (Tamagui / React Native + RN Web)
   RN port of the web YouView: profile header (avatar + name), verdict
   stat tiles, money-saved card, a language switcher wired to the i18n
   provider, and a settings list.

   "Money saved" is computed locally from the passed-in items (sum of
   "nah" prices) — mirrors the web original, which framed it the same
   way without hitting the stats endpoint.
   ============================================================ */

import { type GetProps, ScrollView, Text, View } from 'tamagui'
import { LANGS, type Taste } from '@yon/shared'

import { Avatar, Button, Card, Icon, LangSwitcher } from '@/components/ds'
import { useAuth } from '@/providers/AuthProvider'
import { useI18n } from '@/providers/I18nProvider'

interface Props {
  items: Taste[]
}

function SettingRow({
  icon,
  label,
  last,
}: {
  icon: string
  label: string
  last?: boolean
}) {
  return (
    <View
      flexDirection="row"
      alignItems="center"
      gap="$3"
      paddingVertical={14}
      paddingHorizontal={2}
      borderBottomWidth={last ? 0 : 2}
      borderBottomColor="$ink200"
      borderStyle="dotted"
    >
      <Icon name={icon} size={20} color="#5a4f63" />
      <Text flex={1} color="$ink900" fontWeight="500">
        {label}
      </Text>
      <Icon name="chevron-right" size={18} color="#cfc7d4" />
    </View>
  )
}

export default function YouView({ items }: Props) {
  const { t, lang, setLang, formatMoney } = useI18n()
  const { user, signOut } = useAuth()

  const displayName = user?.displayName || 'Mina Park'

  const count = (v: 'yum' | 'meh' | 'nah') =>
    items.filter((it) => it.verdict === v).length

  const saved = items
    .filter((it) => it.verdict === 'nah')
    .reduce((sum, it) => {
      const n = parseFloat((it.price ?? '').replace(/[^0-9.]/g, ''))
      return sum + (Number.isFinite(n) ? n : 0)
    }, 0)
  const savedAmount = formatMoney(saved)

  const stat = (
    label: string,
    value: number,
    color: GetProps<typeof View>['backgroundColor'],
  ) => (
    <View
      flex={1}
      paddingVertical={14}
      paddingHorizontal={10}
      alignItems="center"
      borderWidth={3}
      borderColor="$ink900"
      borderRadius="$lg"
      backgroundColor={color}
      shadowColor="$ink900"
      shadowOffset={{ width: 5, height: 5 }}
      shadowOpacity={1}
      shadowRadius={0}
    >
      <Text color="#fff" fontWeight="700" fontSize={34} lineHeight={34}>
        {value}
      </Text>
      <Text
        color="#fff"
        fontSize={9}
        letterSpacing={1.1}
        textTransform="uppercase"
        marginTop={6}
      >
        {label}
      </Text>
    </View>
  )

  return (
    <ScrollView flex={1} backgroundColor="$background" contentContainerStyle={{ padding: 20 }}>
      {/* avatar header */}
      <View flexDirection="row" alignItems="center" gap={14} marginTop="$1">
        <Avatar name={displayName} src={user?.avatar || undefined} size="lg" />
        <View flex={1}>
          <View flexDirection="row" alignItems="center" gap={8} flexWrap="wrap">
            <Text color="$ink900" fontWeight="700" fontSize={22}>
              {displayName}
            </Text>
            {user?.plan === 'pro' ? (
              <View
                backgroundColor="$candyYellow"
                borderWidth={2}
                borderColor="$ink900"
                borderRadius="$sm"
                paddingHorizontal={8}
                paddingVertical={2}
              >
                <Text
                  color="$ink900"
                  fontWeight="700"
                  fontSize={10}
                  letterSpacing={0.8}
                  textTransform="uppercase"
                >
                  {t('pro_plan')}
                </Text>
              </View>
            ) : null}
          </View>
          <Text color="$ink500">{t('tastes_logged', { n: items.length })}</Text>
        </View>
        <LangSwitcher
          value={lang}
          onChange={setLang}
          languages={LANGS}
          align="right"
          triggerMode="flag"
        />
      </View>

      {/* verdict stat tiles */}
      <View flexDirection="row" gap="$3" marginTop={18}>
        {stat(t('yum'), count('yum'), '$verdictYum')}
        {stat(t('meh'), count('meh'), '$verdictMeh')}
        {stat(t('nah'), count('nah'), '$verdictNah')}
      </View>

      {/* saved card */}
      <Card
        padded
        marginTop="$4"
        flexDirection="row"
        alignItems="center"
        gap={14}
      >
        <Icon name="coin" size={36} color="#ff5ca8" />
        <View>
          <Text color="$ink900" fontWeight="700" fontSize={24}>
            {t('saved_amt', { amt: savedAmount })}
          </Text>
          <Text color="$ink500" fontSize={14}>
            {t('saved_sub')}
          </Text>
        </View>
      </Card>

      {/* settings list */}
      <View marginTop={18}>
        <Text
          color="$ink400"
          fontSize={10}
          letterSpacing={1.1}
          textTransform="uppercase"
          marginBottom={10}
        >
          {t('settings')}
        </Text>
        <SettingRow icon="alert" label={t('set_warnings')} />
        <SettingRow icon="map" label={t('set_location')} />
        <SettingRow icon="lock" label={t('set_private')} last />
      </View>

      {/* sign out */}
      <Button
        variant="secondary"
        block
        marginTop={18}
        onPress={() => {
          void signOut()
        }}
        iconLeft={<Icon name="arrow-right" size={18} color="#191017" />}
      >
        {t('auth_signout')}
      </Button>
    </ScrollView>
  )
}
