/* ============================================================
   YON — Reanimated spring / timing config presets.
   Values copied verbatim from tamagui.config.ts animations block.
   Used by usePressMotion hooks and any withSpring / withTiming call.
   ============================================================ */

import type { WithSpringConfig, WithTimingConfig } from 'react-native-reanimated'

// ---------- Spring presets ----------

/** bouncy — buttons, verdict picker (damping 9, stiffness 150, mass 0.9) */
export const bouncy: WithSpringConfig = {
  damping: 9,
  stiffness: 150,
  mass: 0.9,
}

/** quick — cards, tags, inputs, lang switcher (damping 20, stiffness 250) */
export const quick: WithSpringConfig = {
  damping: 20,
  stiffness: 250,
}

/** lazy — reserved for large surface transitions (damping 15, stiffness 100) */
export const lazy: WithSpringConfig = {
  damping: 15,
  stiffness: 100,
}

// ---------- Timing presets ----------

export const t100: WithTimingConfig = { duration: 100 }
export const t200: WithTimingConfig = { duration: 200 }

// ---------- Convenience namespace ----------

export const motion = {
  spring: { bouncy, quick, lazy },
  timing: { t100, t200 },
} as const
