/* ============================================================
   YON — pop-shadow presets (plain RN shadow objects).
   Values copied verbatim from tamagui.config.ts popShadow export.
   Neo-brutalist: solid offset, NO blur (shadowRadius: 0).
   Platform caveat: shadowOffset renders on iOS only; Android uses
   border + translate (elevation always blurs). See material-motion.md.
   ============================================================ */

import { colors } from './colors'

// ---------- Pop-shadow presets ----------

export const popShadow = {
  xs: {
    shadowColor: colors.ink900,
    shadowOffset: { width: 2, height: 2 },
    shadowOpacity: 1,
    shadowRadius: 0,
  },
  sm: {
    shadowColor: colors.ink900,
    shadowOffset: { width: 3, height: 3 },
    shadowOpacity: 1,
    shadowRadius: 0,
  },
  md: {
    shadowColor: colors.ink900,
    shadowOffset: { width: 5, height: 5 },
    shadowOpacity: 1,
    shadowRadius: 0,
  },
  lg: {
    shadowColor: colors.ink900,
    shadowOffset: { width: 8, height: 8 },
    shadowOpacity: 1,
    shadowRadius: 0,
  },
  pink: {
    shadowColor: colors.candyPink,
    shadowOffset: { width: 5, height: 5 },
    shadowOpacity: 1,
    shadowRadius: 0,
  },
  blue: {
    shadowColor: colors.candyBlue,
    shadowOffset: { width: 5, height: 5 },
    shadowOpacity: 1,
    shadowRadius: 0,
  },
} as const

// ---------- Pressed shadow variants ----------
// Shadow collapses on press (x/y translate closes the gap — iOS only).
// Button/IconButton: 5x5 → 3x3 (bouncy). Card (interactive): 5x5 → 3x3 (quick).
// Android: translate handles the visual; shadow props unchanged on press.

export const pressedShadow = {
  // Button / IconButton pressed state (nudge x:3 y:3 → offsets collapse to 0)
  button: {
    shadowColor: colors.ink900,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 0,
  },
  // Card interactive pressed state (nudge x:2 y:2 → offsets collapse to 0)
  card: {
    shadowColor: colors.ink900,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 0,
  },
} as const
