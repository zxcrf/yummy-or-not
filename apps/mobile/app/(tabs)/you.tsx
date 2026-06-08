/* You tab — thin route wrapper around components/app/YouView.
   The route header hosts the LangSwitcher wired to the I18nProvider's
   setLang, so language selection persists app-wide (YouView itself is
   sibling-owned and stays untouched). */
import { View } from 'tamagui'
import { LANGS } from '@yon/shared'

import { LangSwitcher } from '@/components/ds'
import YouView from '@/components/app/YouView'
import { useI18n } from '@/providers/I18nProvider'
import { Screen } from './_screen'
import { useTastes } from './_useTastes'

export default function YouRoute() {
  const { lang, setLang } = useI18n()
  const items = useTastes()
  return (
    <Screen>
      <View paddingHorizontal="$4" paddingTop="$3" paddingBottom="$2">
        <LangSwitcher
          value={lang}
          onChange={setLang}
          languages={LANGS}
          align="right"
          tone="$candyPink"
        />
      </View>
      <YouView items={items} />
    </Screen>
  )
}
