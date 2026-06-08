// Locale union for the font loader. Mirrors the i18n `Lang` type in the
// shared package (zh/en/ko/ja/es). Kept local for this DS wave so the mobile
// app has no hard dependency on @yon/shared yet; swap to
//   import type { Lang } from '@yon/shared'
// once the shared package is wired into the mobile workspace.
export type Lang = 'zh' | 'en' | 'ko' | 'ja' | 'es'
