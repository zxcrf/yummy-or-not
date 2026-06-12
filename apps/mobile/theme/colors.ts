/* ============================================================
   YON — resolved color constants (no runtime token lookup).
   Values copied verbatim from tamagui.config.ts palette + yumTheme.
   ============================================================ */

// ---------- Raw palette ----------

export const ink900 = '#191017'
export const ink700 = '#3a2c36'
export const ink500 = '#6b5b65'
export const ink400 = '#8f8189'
export const ink300 = '#b8aeb4'
export const ink200 = '#ddd6da'
export const ink100 = '#ece7ea'

export const paper = '#fff6e6'
export const paper2 = '#ffeecf'
export const paper3 = '#ffe6b8'
export const white = '#ffffff'

export const candyPink = '#ff2e88'
export const candyPinkDeep = '#d6005f'
export const candyYellow = '#ffd12e'
export const candyTangerine = '#ff6a1a'
export const candyBlue = '#2f6bff'
export const candyCyan = '#16d6e6'
export const candyLime = '#8ce60e'
export const candyGrape = '#9b4dff'
export const candyMint = '#19e68c'

export const verdictYum = '#14c46b'
export const verdictYum2 = '#0a9b51'
export const verdictMeh = '#ffb20e'
export const verdictMeh2 = '#d98b00'
export const verdictNah = '#ff3147'
export const verdictNah2 = '#d40e26'

export const onBrand = '#ffffff'

// ---------- Token-group semantic aliases (config L98-100) ----------

export const brand = candyPink
export const brandDeep = candyPinkDeep
export const focusRing = candyBlue

// ---------- Full yum-theme alias map (config L228-267) ----------
// Every key from yumTheme, resolved to its palette hex.
// backgroundStrong = white (#ffffff).
// backgroundTransparent / colorTransparent are rgba strings (needed by DS).

export const background = paper                          // '#fff6e6'
export const backgroundHover = paper2                   // '#ffeecf'
export const backgroundPress = paper3                   // '#ffe6b8'
export const backgroundFocus = paper2                   // '#ffeecf'
export const backgroundStrong = white                   // '#ffffff'
export const backgroundTransparent = 'rgba(255,246,230,0)' as const

export const color = ink900                             // '#191017'
export const colorHover = ink700                        // '#3a2c36'
export const colorPress = ink900                        // '#191017'
export const colorFocus = ink900                        // '#191017'
export const colorTransparent = 'rgba(25,16,23,0)' as const

export const colorMuted = ink500                        // '#6b5b65'
export const colorFaint = ink400                        // '#8f8189'

export const borderColor = ink900                       // '#191017'
export const borderColorHover = ink900                  // '#191017'
export const borderColorPress = ink900                  // '#191017'
export const borderColorFocus = candyBlue               // '#2f6bff'
export const borderColorSoft = ink200                   // '#ddd6da'

// brand / brandDeep already exported above (same resolved values)
export const accent = candyPink                         // '#ff2e88'

export const success = verdictYum                       // '#14c46b'
export const warning = verdictMeh                       // '#ffb20e'
export const danger = verdictNah                        // '#ff3147'
export const info = candyBlue                           // '#2f6bff'

export const shadowColor = ink900                       // '#191017'
export const shadowColorHover = ink900                  // '#191017'
export const shadowColorPress = ink900                  // '#191017'
export const shadowColorFocus = ink900                  // '#191017'

// ---------- Convenience namespace object ----------
// Allows `import { colors } from '@/theme'` and `colors.ink900`.

export const colors = {
  // raw palette
  ink900,
  ink700,
  ink500,
  ink400,
  ink300,
  ink200,
  ink100,
  paper,
  paper2,
  paper3,
  white,
  candyPink,
  candyPinkDeep,
  candyYellow,
  candyTangerine,
  candyBlue,
  candyCyan,
  candyLime,
  candyGrape,
  candyMint,
  verdictYum,
  verdictYum2,
  verdictMeh,
  verdictMeh2,
  verdictNah,
  verdictNah2,
  onBrand,
  // semantic token-group aliases
  brand,
  brandDeep,
  focusRing,
  // yum-theme aliases
  background,
  backgroundHover,
  backgroundPress,
  backgroundFocus,
  backgroundStrong,
  backgroundTransparent,
  color,
  colorHover,
  colorPress,
  colorFocus,
  colorTransparent,
  colorMuted,
  colorFaint,
  borderColor,
  borderColorHover,
  borderColorPress,
  borderColorFocus,
  borderColorSoft,
  accent,
  success,
  warning,
  danger,
  info,
  shadowColor,
  shadowColorHover,
  shadowColorPress,
  shadowColorFocus,
} as const

export type Colors = typeof colors
