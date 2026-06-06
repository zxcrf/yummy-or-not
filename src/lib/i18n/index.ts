// Yummy or Not — i18n runtime.
// String tables live in ./locales/<code>.ts (CC0).
// This file exports the language list, types, and the translate helper.

import { zh } from "./locales/zh";
import { en } from "./locales/en";
import { ko } from "./locales/ko";
import { ja } from "./locales/ja";
import { es } from "./locales/es";

export type Lang = "zh" | "en" | "ko" | "ja" | "es";

// Order = order shown in the switcher. Chinese first, English second.
export const LANGS: { code: Lang; label: string; native: string }[] = [
  { code: "zh", label: "Chinese",  native: "中文" },
  { code: "en", label: "English",  native: "English" },
  { code: "ko", label: "Korean",   native: "한국어" },
  { code: "ja", label: "Japanese", native: "日本語" },
  { code: "es", label: "Spanish",  native: "Español" },
];

export const DEFAULT_LANG: Lang = "zh";

const STRINGS: Record<Lang, Record<string, string>> = { zh, en, ko, ja, es };

/**
 * Interpolation vars: {n}, {amt}, {q} and any other {key} placeholders.
 * Falls back to en, then the raw key if missing from both tables.
 */
export function translate(lang: Lang, key: string, vars?: Record<string, string | number>): string {
  const table = STRINGS[lang] ?? STRINGS.en;
  const fallback = STRINGS.en;
  let s: string = table[key] != null ? table[key] : (fallback[key] != null ? fallback[key] : key);
  if (vars) {
    s = s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? String(vars[k]) : ""));
  }
  return s;
}

// Fusion Pixel CJK font-stack per lang, used to set --font-cjk-pixel.
// Values match the font-family names declared in the DS tokens.
export const CJK_STACK: Record<Lang, string> = {
  zh: "SC,JP,KR",
  en: "SC,JP,KR",
  es: "SC,JP,KR",
  ja: "JP,SC,KR",
  ko: "KR,JP,SC",
};
