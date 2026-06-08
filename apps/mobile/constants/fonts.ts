/* ============================================================
   YUMMY OR NOT — Font loading scaffolding (expo-font)
   Mirrors the intent of tokens/fonts.css + i18n CJK_STACK.

   The web DS loads three Latin pixel/grotesque families (Pixelify Sans,
   Space Grotesk, Silkscreen) plus a per-locale pan-CJK pixel family
   (Fusion Pixel 12px Proportional SC/JP/KR) so Han forms match the locale.

   TODO(fonts): drop the real .ttf binaries into assets/fonts/ and uncomment
   the require()s below. Until then this map is empty so the app boots on the
   system font (createFont family: 'System' in tamagui.config.ts).
   ============================================================ */

import type { Lang } from './i18nFont'

// Latin display/body/micro families (always loaded once bundled).
// TODO(fonts): bundle these .ttf files, then add them to LATIN_FONTS.
export const LATIN_FONTS: Record<string, number> = {
  // 'PixelifySans': require('../assets/fonts/PixelifySans-Regular.ttf'),
  // 'SpaceGrotesk': require('../assets/fonts/SpaceGrotesk-Regular.ttf'),
  // 'Silkscreen': require('../assets/fonts/Silkscreen-Regular.ttf'),
}

// Pan-CJK pixel families, keyed by the script the locale primarily needs.
// TODO(fonts): bundle the Fusion Pixel 12px Proportional SC/JP/KR .ttf files.
export const CJK_FONTS: Record<'sc' | 'jp' | 'kr', number | null> = {
  sc: null, // require('../assets/fonts/FusionPixel-Proportional-SC.ttf'),
  jp: null, // require('../assets/fonts/FusionPixel-Proportional-JP.ttf'),
  kr: null, // require('../assets/fonts/FusionPixel-Proportional-KR.ttf'),
}

// Which CJK script each locale prefers — derived from i18n CJK_STACK ordering:
//   zh/en/es → SC first · ja → JP first · ko → KR first.
const LOCALE_CJK_PREFERENCE: Record<Lang, 'sc' | 'jp' | 'kr'> = {
  zh: 'sc',
  en: 'sc',
  es: 'sc',
  ja: 'jp',
  ko: 'kr',
}

/**
 * Build the expo-font map to load for a given locale: the Latin families plus
 * the locale's preferred pan-CJK pixel family. Null entries (unbundled fonts)
 * are filtered out so loading never fails before the .ttf files exist.
 */
export function fontMapForLocale(lang: Lang): Record<string, number> {
  const map: Record<string, number> = { ...LATIN_FONTS }
  const cjkKey = LOCALE_CJK_PREFERENCE[lang]
  const cjkAsset = CJK_FONTS[cjkKey]
  if (cjkAsset != null) {
    map[`FusionPixel-${cjkKey.toUpperCase()}`] = cjkAsset
  }
  return map
}
