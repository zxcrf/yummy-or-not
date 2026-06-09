/* ============================================================
   YUMMY OR NOT — Tamagui design system
   Ported 1:1 from src/styles/ds/tokens/*.css (the web DS).
   Candy-pop palette on warm cream + ink. Hard pixel pop-shadows.
   Keep hex values in sync with tokens/colors.css.
   ============================================================ */

import { createFont, createTamagui, createTokens } from 'tamagui'
import { createAnimations } from '@tamagui/animations-react-native'

const animations = createAnimations({
  bouncy: { type: 'spring', damping: 9, stiffness: 150, mass: 0.9 },
  quick: { type: 'spring', damping: 20, stiffness: 250 },
  lazy: { type: 'spring', damping: 15, stiffness: 100 },
  '100ms': { type: 'timing', duration: 100 },
  '200ms': { type: 'timing', duration: 200 },
})

/* ---------- Raw palette (mirrors tokens/colors.css) ---------- */
const palette = {
  // Ink (warm near-black neutral ramp)
  ink900: '#191017',
  ink700: '#3a2c36',
  ink500: '#6b5b65',
  ink400: '#8f8189',
  ink300: '#b8aeb4',
  ink200: '#ddd6da',
  ink100: '#ece7ea',

  // Paper (warm cream surfaces)
  paper: '#fff6e6',
  paper2: '#ffeecf',
  paper3: '#ffe6b8',
  white: '#ffffff',

  // Candy hues (the pop palette)
  candyPink: '#ff2e88', // brand primary
  candyPinkDeep: '#d6005f',
  candyYellow: '#ffd12e',
  candyTangerine: '#ff6a1a',
  candyBlue: '#2f6bff',
  candyCyan: '#16d6e6',
  candyLime: '#8ce60e',
  candyGrape: '#9b4dff',
  candyMint: '#19e68c',

  // Verdict colors (the core product semantic)
  verdictYum: '#14c46b',
  verdictYum2: '#0a9b51',
  verdictMeh: '#ffb20e',
  verdictMeh2: '#d98b00',
  verdictNah: '#ff3147',
  verdictNah2: '#d40e26',

  onBrand: '#ffffff',
} as const

/* ---------- Tokens ----------
   Tamagui requires the size / space / radius / zIndex / color groups.
   space + size mirror tokens/spacing.css (4px grid).
   radius mirrors the corner radii in tokens/effects.css.
   color is the full palette above (named keys → $candyPink etc.). */
export const tokens = createTokens({
  color: {
    ink900: palette.ink900,
    ink700: palette.ink700,
    ink500: palette.ink500,
    ink400: palette.ink400,
    ink300: palette.ink300,
    ink200: palette.ink200,
    ink100: palette.ink100,

    paper: palette.paper,
    paper2: palette.paper2,
    paper3: palette.paper3,
    white: palette.white,

    candyPink: palette.candyPink,
    candyPinkDeep: palette.candyPinkDeep,
    candyYellow: palette.candyYellow,
    candyTangerine: palette.candyTangerine,
    candyBlue: palette.candyBlue,
    candyCyan: palette.candyCyan,
    candyLime: palette.candyLime,
    candyGrape: palette.candyGrape,
    candyMint: palette.candyMint,

    verdictYum: palette.verdictYum,
    verdictYum2: palette.verdictYum2,
    verdictMeh: palette.verdictMeh,
    verdictMeh2: palette.verdictMeh2,
    verdictNah: palette.verdictNah,
    verdictNah2: palette.verdictNah2,

    onBrand: palette.onBrand,

    // Semantic aliases (mirror tokens/colors.css :root aliases)
    brand: palette.candyPink,
    brandDeep: palette.candyPinkDeep,
    focusRing: palette.candyBlue,
  },

  // 4px base grid — mirrors tokens/spacing.css --space-*
  space: {
    0: 0,
    1: 4,
    2: 8,
    3: 12,
    4: 16,
    5: 20,
    6: 24,
    7: 32,
    8: 40,
    9: 48,
    10: 64,
    11: 80,
    12: 96,
    true: 16, // Tamagui requires a `true` key (default space)
  },

  // size reuses the spacing scale (Tamagui needs a size group)
  size: {
    0: 0,
    1: 4,
    2: 8,
    3: 12,
    4: 16,
    5: 20,
    6: 24,
    7: 32,
    8: 40,
    9: 48,
    10: 64,
    11: 80,
    12: 96,
    true: 16,
  },

  // Corner radii — mirrors tokens/effects.css --radius-*
  radius: {
    0: 0,
    xs: 4,
    sm: 6,
    md: 10,
    lg: 16,
    xl: 22,
    pill: 999,
    true: 10,
  },

  // Z-index — mirrors tokens/effects.css --z-*
  zIndex: {
    0: 0,
    base: 1,
    sticky: 100,
    overlay: 1000,
    toast: 2000,
    true: 1,
  },
})

/* ---------- Fonts ----------
   tokens/typography.css uses Pixelify Sans (display), Space Grotesk (body),
   Silkscreen (micro), with a per-locale pan-CJK pixel fallback.
   The real .ttf binaries are not bundled yet (see app/_layout.tsx font TODO),
   so families fall back to the system font and the app still boots.
   Type scale + line heights mirror typography.css. */
const bodyFont = createFont({
  family: 'System',
  size: {
    1: 10, // --text-3xs
    2: 11, // --text-2xs
    3: 12, // --text-xs
    4: 14, // --text-sm
    5: 16, // --text-md (base body)
    6: 18, // --text-lg
    7: 22, // --text-xl
    8: 28, // --text-2xl
    9: 36, // --text-3xl
    10: 48, // --text-4xl
    11: 64, // --text-5xl
    12: 84, // --text-6xl
    true: 16,
  },
  lineHeight: {
    1: 14,
    2: 16,
    3: 17,
    4: 20,
    5: 23, // ~1.45 * 16 (--leading-normal)
    6: 26,
    7: 27,
    8: 34,
    9: 43,
    10: 58,
    11: 77,
    12: 101,
    true: 23,
  },
  weight: {
    1: '300', // --weight-light
    4: '400', // --weight-regular
    5: '500', // --weight-medium
    6: '600', // --weight-semibold
    7: '700', // --weight-bold
  },
  letterSpacing: {
    1: -0.32, // ~ -0.02em @ 16px (--tracking-tight)
    4: 0, // --tracking-normal
    5: 0.64, // ~ 0.04em (--tracking-wide)
    6: 1.92, // ~ 0.12em (--tracking-wider)
  },
})

// Display font reuses the same scale; swap `family` to "Pixelify Sans"
// once the pixel display .ttf is bundled via expo-font.
const displayFont = createFont({
  ...bodyFont,
  family: 'System',
})

/* ---------- Themes ----------
   `yum` = light candy-pop theme on cream, ink-900 text/borders, brand accents.
   Mirrors the semantic aliases in tokens/colors.css.
   Verdict sub-themes (yum/meh/nah) recolor `accent`/`borderColor` so a
   <Theme name="yum_yum"> etc. can tint verdict-scoped UI. */
const yumTheme = {
  background: palette.paper,
  backgroundHover: palette.paper2,
  backgroundPress: palette.paper3,
  backgroundFocus: palette.paper2,
  backgroundStrong: palette.white,
  backgroundTransparent: 'rgba(255,246,230,0)',

  color: palette.ink900,
  colorHover: palette.ink700,
  colorPress: palette.ink900,
  colorFocus: palette.ink900,
  colorTransparent: 'rgba(25,16,23,0)',

  // muted / faint text from the ink ramp
  colorMuted: palette.ink500,
  colorFaint: palette.ink400,

  borderColor: palette.ink900,
  borderColorHover: palette.ink900,
  borderColorPress: palette.ink900,
  borderColorFocus: palette.candyBlue, // --focus-ring
  borderColorSoft: palette.ink200,

  // brand accents
  brand: palette.candyPink,
  brandDeep: palette.candyPinkDeep,
  accent: palette.candyPink,
  onBrand: palette.onBrand,

  // verdict semantics
  success: palette.verdictYum,
  warning: palette.verdictMeh,
  danger: palette.verdictNah,
  info: palette.candyBlue,

  // hard pop-shadow color (tokens/effects.css shadows are solid ink-900)
  shadowColor: palette.ink900,
  shadowColorHover: palette.ink900,
  shadowColorPress: palette.ink900,
  shadowColorFocus: palette.ink900,
} as const

const verdictYumTheme = {
  ...yumTheme,
  accent: palette.verdictYum,
  borderColor: palette.verdictYum2,
}
const verdictMehTheme = {
  ...yumTheme,
  accent: palette.verdictMeh,
  borderColor: palette.verdictMeh2,
}
const verdictNahTheme = {
  ...yumTheme,
  accent: palette.verdictNah,
  borderColor: palette.verdictNah2,
}

const config = createTamagui({
  animations,
  fonts: {
    heading: displayFont,
    body: bodyFont,
  },
  tokens,
  themes: {
    yum: yumTheme,
    yum_yum: verdictYumTheme,
    yum_meh: verdictMehTheme,
    yum_nah: verdictNahTheme,
  },
  // Responsive breakpoints mirror tokens/spacing.css container widths.
  media: {
    sm: { maxWidth: 480 },
    md: { maxWidth: 768 },
    lg: { maxWidth: 1080 },
    xl: { maxWidth: 1280 },
    gtSm: { minWidth: 480 + 1 },
    gtMd: { minWidth: 768 + 1 },
    gtLg: { minWidth: 1080 + 1 },
    short: { maxHeight: 820 },
    hoverable: { hover: 'hover' },
    pointerCoarse: { pointer: 'coarse' },
  },
  shorthands: {
    p: 'padding',
    px: 'paddingHorizontal',
    py: 'paddingVertical',
    m: 'margin',
    mx: 'marginHorizontal',
    my: 'marginVertical',
    f: 'flex',
    w: 'width',
    h: 'height',
    br: 'borderRadius',
    bw: 'borderWidth',
    bg: 'backgroundColor',
  } as const,
  settings: {
    allowedStyleValues: 'somewhat-strict',
  },
})

export type AppConfig = typeof config

declare module 'tamagui' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface TamaguiCustomConfig extends AppConfig {}
}

export default config
export const tamaguiConfig = config

/* ---------- Pop-shadow presets ----------
   tokens/effects.css uses SOLID offset shadows with NO blur (neo-brutalist).
   PLATFORM CAVEAT: RN's shadowRadius:0 + offset reproduces the hard look on
   iOS; Android elevation always blurs, so use these as `shadow*` props on iOS
   and `boxShadow` on web. Border widths (2/3/4px) come from tokens/effects.css. */
export const popShadow = {
  xs: { shadowColor: palette.ink900, shadowOffset: { width: 2, height: 2 }, shadowOpacity: 1, shadowRadius: 0 },
  sm: { shadowColor: palette.ink900, shadowOffset: { width: 3, height: 3 }, shadowOpacity: 1, shadowRadius: 0 },
  md: { shadowColor: palette.ink900, shadowOffset: { width: 5, height: 5 }, shadowOpacity: 1, shadowRadius: 0 },
  lg: { shadowColor: palette.ink900, shadowOffset: { width: 8, height: 8 }, shadowOpacity: 1, shadowRadius: 0 },
  pink: { shadowColor: palette.candyPink, shadowOffset: { width: 5, height: 5 }, shadowOpacity: 1, shadowRadius: 0 },
  blue: { shadowColor: palette.candyBlue, shadowOffset: { width: 5, height: 5 }, shadowOpacity: 1, shadowRadius: 0 },
} as const

// Web-only hard box-shadows (no blur) mirroring tokens/effects.css --shadow-pop-*.
export const popBoxShadow = {
  xs: '2px 2px 0 #191017',
  sm: '3px 3px 0 #191017',
  md: '5px 5px 0 #191017',
  lg: '8px 8px 0 #191017',
  pink: '5px 5px 0 #ff2e88',
  blue: '5px 5px 0 #2f6bff',
} as const

// Chunky ink border widths — tokens/effects.css --border-thin/-w/-thick.
export const borderWidths = { thin: 2, base: 3, thick: 4 } as const
