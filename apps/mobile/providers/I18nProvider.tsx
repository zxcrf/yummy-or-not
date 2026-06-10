/* ============================================================
   YUMMY OR NOT — I18nProvider (React Native + RN Web)
   Port of the web src/lib/i18n/I18nProvider.tsx context to RN.

   Exposes { lang, setLang, t } built on @yon/shared translate/LANGS/
   DEFAULT_LANG. Persists the chosen lang across launches:
     • web   → localStorage (synchronous, available immediately)
     • native → @react-native-async-storage/async-storage (async)
   Persistence is Platform-gated so the web bundle never pulls the
   AsyncStorage native module and native never touches `window`.
   ============================================================ */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { Platform } from 'react-native'
import { DEFAULT_LANG, LANG_CURRENCY, LANGS, translate, type Lang } from '@yon/shared'

// ----------------------------------------------------------------
// Context shape
// ----------------------------------------------------------------

interface I18nContextValue {
  lang: Lang
  /** Accepts any string; silently ignores unknown codes. */
  setLang: (lang: string) => void
  t: (key: string, vars?: Record<string, string | number>) => string
  formatMoney: (amount: number) => string
}

const I18nContext = createContext<I18nContextValue>({
  lang: DEFAULT_LANG,
  setLang: () => {},
  t: (key) => key,
  formatMoney: (n) => `$${n.toFixed(2)}`,
})

// ----------------------------------------------------------------
// Persistence — Platform-gated read/write of the stored lang code.
// ----------------------------------------------------------------

const STORAGE_KEY = 'yon_lang'

function isValidLang(code: string): code is Lang {
  return LANGS.some((l) => l.code === code)
}

/** Read the persisted lang (or null). Async to accommodate AsyncStorage. */
async function readStoredLang(): Promise<Lang | null> {
  try {
    if (Platform.OS === 'web') {
      const stored = globalThis.localStorage?.getItem(STORAGE_KEY)
      return stored && isValidLang(stored) ? stored : null
    }
    // Native: lazy-require so the web bundle never loads the native module.
    const AsyncStorage = (
      await import('@react-native-async-storage/async-storage')
    ).default
    const stored = await AsyncStorage.getItem(STORAGE_KEY)
    return stored && isValidLang(stored) ? stored : null
  } catch {
    return null
  }
}

/** Persist the lang. Fire-and-forget; failures are non-fatal. */
function writeStoredLang(lang: Lang): void {
  try {
    if (Platform.OS === 'web') {
      globalThis.localStorage?.setItem(STORAGE_KEY, lang)
      return
    }
    void import('@react-native-async-storage/async-storage').then(
      ({ default: AsyncStorage }) => AsyncStorage.setItem(STORAGE_KEY, lang),
    )
  } catch {
    // ignore — persistence is best-effort.
  }
}

// ----------------------------------------------------------------
// Provider
// ----------------------------------------------------------------

interface I18nProviderProps {
  children: ReactNode
}

/**
 * I18nProvider — wraps the app and provides { lang, setLang, t }.
 * Defaults to DEFAULT_LANG ("zh"), then reconciles from persisted
 * storage on mount. Persists on every change.
 */
export function I18nProvider({ children }: I18nProviderProps) {
  const [lang, setLangState] = useState<Lang>(DEFAULT_LANG)

  // Hydrate from storage once mounted.
  useEffect(() => {
    let active = true
    readStoredLang().then((stored) => {
      if (active && stored) setLangState(stored)
    })
    return () => {
      active = false
    }
  }, [])

  const setLang = useCallback((next: string) => {
    if (!isValidLang(next)) return
    setLangState(next)
    writeStoredLang(next)
  }, [])

  const value = useMemo<I18nContextValue>(
    () => ({
      lang,
      setLang,
      t: (key, vars) => translate(lang, key, vars),
      formatMoney: (n: number) => {
        const { symbol } = LANG_CURRENCY[lang]
        return `${symbol}${n.toFixed(2)}`
      },
    }),
    [lang, setLang],
  )

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

// ----------------------------------------------------------------
// Hooks
// ----------------------------------------------------------------

/** Returns { lang, setLang, t }. Must be used inside <I18nProvider>. */
export function useI18n(): I18nContextValue {
  return useContext(I18nContext)
}

/** Convenience hook — returns just the t() translate function. */
export function useT(): (
  key: string,
  vars?: Record<string, string | number>,
) => string {
  return useContext(I18nContext).t
}
