/* ============================================================
   YUMMY OR NOT — I18nProvider (React Native, mobile-only)
   Port of the web src/lib/i18n/I18nProvider.tsx context to RN.

   Exposes { lang, setLang, t } built on @yon/shared translate/LANGS/
   DEFAULT_LANG. Persists the chosen lang across launches via
   @react-native-async-storage/async-storage.
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
import { DEFAULT_LANG, LANG_CURRENCY, LANGS, translate, type Lang } from '@yon/shared'

// ----------------------------------------------------------------
// Context shape
// ----------------------------------------------------------------

interface I18nContextValue {
  lang: Lang
  /** Accepts any string; silently ignores unknown codes. */
  setLang: (lang: string) => void
  t: (key: string, vars?: Record<string, string | number>) => string
  formatMoney: (amount: number | string) => string
}

const I18nContext = createContext<I18nContextValue>({
  lang: DEFAULT_LANG,
  setLang: () => {},
  t: (key) => key,
  formatMoney: () => '',
})

// ----------------------------------------------------------------
// Persistence — Platform-gated read/write of the stored lang code.
// ----------------------------------------------------------------

const STORAGE_KEY = 'yon_lang'

function isValidLang(code: string): code is Lang {
  return LANGS.some((l) => l.code === code)
}

function formatMoneyValue(amount: number | string, lang: Lang): string {
  const raw = typeof amount === 'string' ? amount.replace(/[^0-9.]/g, '') : amount
  if (raw === '') return ''
  const value = typeof raw === 'number' ? raw : Number.parseFloat(raw)
  if (!Number.isFinite(value)) return ''
  const { symbol } = LANG_CURRENCY[lang]
  return Number.isInteger(value) ? `${symbol}${value}` : `${symbol}${value.toFixed(2)}`
}

/** Read the persisted lang (or null). */
async function readStoredLang(): Promise<Lang | null> {
  try {
    // Use require() so jest.mock in jest.setup.js can intercept it (dynamic
    // import() bypasses jest.mock without --experimental-vm-modules).
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const AsyncStorage = (require('@react-native-async-storage/async-storage') as typeof import('@react-native-async-storage/async-storage')).default
    const stored = await AsyncStorage.getItem(STORAGE_KEY)
    return stored && isValidLang(stored) ? stored : null
  } catch {
    return null
  }
}

/** Persist the lang. Fire-and-forget; failures are non-fatal. */
function writeStoredLang(lang: Lang): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const AsyncStorage = (require('@react-native-async-storage/async-storage') as typeof import('@react-native-async-storage/async-storage')).default
    void AsyncStorage.setItem(STORAGE_KEY, lang)
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
      formatMoney: (amount) => formatMoneyValue(amount, lang),
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
