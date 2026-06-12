/* ============================================================
   YON — spacing, radius, border widths, z-index constants.
   Values copied verbatim from tamagui.config.ts tokens.
   4px base grid — mirrors tokens/spacing.css.
   ============================================================ */

// ---------- Space (4px grid) ----------
// Index matches the Tamagui space token index.
// space[0]=0, space[1]=4, …, space[12]=96, space.true=16

export const space: Record<number, number> & { true: number } = {
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
}

// ---------- Radius ----------
// Mirrors tokens/effects.css --radius-*

export const radius = {
  0: 0,
  xs: 4,
  sm: 6,
  md: 10,
  lg: 16,
  xl: 22,
  pill: 999,
} as const

// ---------- Border widths ----------
// Chunky ink borders — tokens/effects.css --border-thin/-w/-thick

export const borderWidths = {
  thin: 2,
  base: 3,
  thick: 4,
} as const

// ---------- Z-index ----------

export const zIndex = {
  base: 1,
  sticky: 100,
  overlay: 1000,
  toast: 2000,
} as const
