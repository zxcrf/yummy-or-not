"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  type ReactNode,
  type CSSProperties,
} from "react";
import { type Lang, DEFAULT_LANG, LANGS, CJK_STACK, translate } from "./index";

// ----------------------------------------------------------------
// Context shape
// ----------------------------------------------------------------

interface I18nContextValue {
  lang: Lang;
  /** Accepts any string; silently ignores unknown codes. */
  setLang: (lang: string) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue>({
  lang: DEFAULT_LANG,
  setLang: () => {},
  t: (key) => key,
});

// ----------------------------------------------------------------
// Provider
// ----------------------------------------------------------------

const LS_KEY = "yon_lang";

function isValidLang(code: string): code is Lang {
  return LANGS.some((l) => l.code === code);
}

interface I18nProviderProps {
  children: ReactNode;
}

/**
 * I18nProvider — wraps the app and provides { lang, setLang, t }.
 * Reads yon_lang from localStorage on mount; persists on change.
 * Sets --font-cjk-pixel CSS var on the wrapper element per active lang.
 */
export function I18nProvider({ children }: I18nProviderProps) {
  // Default to zh on server; reconcile from localStorage in an effect.
  const [lang, setLangState] = useState<Lang>(DEFAULT_LANG);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Hydrate from localStorage once mounted.
  useEffect(() => {
    try {
      const stored = localStorage.getItem(LS_KEY);
      if (stored && isValidLang(stored)) {
        setLangState(stored);
      }
    } catch {
      // localStorage may be unavailable (SSR, private mode).
    }
  }, []);

  // Update --font-cjk-pixel whenever lang changes.
  useEffect(() => {
    if (wrapperRef.current) {
      wrapperRef.current.style.setProperty("--font-cjk-pixel", CJK_STACK[lang]);
    }
  }, [lang]);

  const setLang = (next: string) => {
    if (!isValidLang(next)) return;
    setLangState(next);
    try {
      localStorage.setItem(LS_KEY, next);
    } catch {
      // ignore
    }
  };

  const t = (key: string, vars?: Record<string, string | number>) => translate(lang, key, vars);

  return (
    <I18nContext.Provider value={{ lang, setLang, t }}>
      <div ref={wrapperRef} style={{ "--font-cjk-pixel": CJK_STACK[lang] } as CSSProperties}>
        {children}
      </div>
    </I18nContext.Provider>
  );
}

// ----------------------------------------------------------------
// Hooks
// ----------------------------------------------------------------

/** Returns { lang, setLang, t }. Must be used inside <I18nProvider>. */
export function useI18n(): I18nContextValue {
  return useContext(I18nContext);
}

/** Convenience hook — returns just the t() translate function. */
export function useT(): (key: string, vars?: Record<string, string | number>) => string {
  return useContext(I18nContext).t;
}
