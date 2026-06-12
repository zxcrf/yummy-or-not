/* ============================================================
   YON — typography constants.
   Values copied verbatim from bodyFont in tamagui.config.ts.
   Scale indices 1-12 match Tamagui font size token indices.
   ============================================================ */

// ---------- Font size ----------
// Index matches createFont size keys. fontSize[5] = 16 (base body).

export const fontSize: Record<number, number> & { true: number } = {
  1: 10,  // --text-3xs
  2: 11,  // --text-2xs
  3: 12,  // --text-xs
  4: 14,  // --text-sm
  5: 16,  // --text-md (base body)
  6: 18,  // --text-lg
  7: 22,  // --text-xl
  8: 28,  // --text-2xl
  9: 36,  // --text-3xl
  10: 48, // --text-4xl
  11: 64, // --text-5xl
  12: 84, // --text-6xl
  true: 16,
}

// ---------- Line height ----------
// lineHeight[5] = 23 (~1.45 * 16, --leading-normal)

export const lineHeight: Record<number, number> & { true: number } = {
  1: 14,
  2: 16,
  3: 17,
  4: 20,
  5: 23,
  6: 26,
  7: 27,
  8: 34,
  9: 43,
  10: 58,
  11: 77,
  12: 101,
  true: 23,
}

// ---------- Font weight ----------
// Keys match Tamagui weight token keys.

export const fontWeight = {
  1: '300', // --weight-light
  4: '400', // --weight-regular
  5: '500', // --weight-medium
  6: '600', // --weight-semibold
  7: '700', // --weight-bold
} as const

// ---------- Letter spacing ----------

export const letterSpacing = {
  1: -0.32, // ~ -0.02em @ 16px (--tracking-tight)
  4: 0,     // --tracking-normal
  5: 0.64,  // ~ 0.04em (--tracking-wide)
  6: 1.92,  // ~ 0.12em (--tracking-wider)
} as const

// ---------- Convenience namespace ----------

export const type = {
  fontSize,
  lineHeight,
  fontWeight,
  letterSpacing,
} as const

// ---------- textBase ----------
// Baseline style for every Text element (§1.1b).
// Applied by the @/theme Text wrapper; also used inline on Animated.Text.
// Matches Tamagui's inherited default: size 5 / lineHeight 5 / weight 400.
// Font family: 'System' = RN default (matches tamagui.config.ts bodyFont).

import { colors } from './colors'

export const textBase = {
  color: colors.ink900,      // '#191017'
  fontSize: fontSize[5],     // 16
  lineHeight: lineHeight[5], // 23
  fontWeight: '400' as const,
} as const
