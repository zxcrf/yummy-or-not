/* ============================================================
   YON — theme barrel.
   Single import point: `import { colors, space, radius, … } from '@/theme'`
   ============================================================ */

// Colors — full palette + yum-theme alias map
export * from './colors'
export { colors } from './colors'
export type { Colors } from './colors'

// Space, radius, border widths, z-index
export * from './space'
export { space, radius, borderWidths, zIndex } from './space'

// Typography + textBase
export * from './type'
export { fontSize, lineHeight, fontWeight, letterSpacing, type, textBase } from './type'

// Shadows
export * from './shadows'
export { popShadow, pressedShadow } from './shadows'

// Motion presets
export * from './motion'
export { bouncy, quick, lazy, t100, t200, motion } from './motion'

// Press hooks
export { usePressScale, usePressNudge } from './usePressMotion'
export type { PressMotionConfig, PressScaleConfig, PressNudgeConfig, PressMotionResult } from './usePressMotion'

// Text wrapper (baseline-default)
export { Text, textBase as textBaseStyle } from './Text'
export { default as ThemeText } from './Text'
