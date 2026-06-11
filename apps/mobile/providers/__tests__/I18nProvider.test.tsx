/* ============================================================
   Regression tests — locale-driven money formatting.

   User feedback: changing language should also update the currency symbol
   shown in saved-money UI, instead of leaving hardcoded dollars.
   ============================================================ */

import TestRenderer, { act } from 'react-test-renderer'
import { Platform } from 'react-native'

import { I18nProvider, useI18n } from '../I18nProvider'
import type { Lang } from '@yon/shared'

const formattedByLang: Record<string, string> = {}
let setLangRef: ((lang: Lang) => void) | null = null

function MoneyProbe() {
  const { lang, setLang, formatMoney } = useI18n()
  formattedByLang[lang] = formatMoney(12.5)
  setLangRef = setLang

  return null
}

describe('I18nProvider money formatting', () => {
  let realOS: typeof Platform.OS
  let realLocalStorage: PropertyDescriptor | undefined

  beforeEach(() => {
    realOS = Platform.OS
    realLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'web' })
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: jest.fn(() => null),
        setItem: jest.fn(),
      },
    })
    Object.keys(formattedByLang).forEach((key) => {
      delete formattedByLang[key]
    })
    setLangRef = null
  })

  afterEach(() => {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: realOS })
    if (realLocalStorage) {
      Object.defineProperty(globalThis, 'localStorage', realLocalStorage)
    } else {
      delete (globalThis as { localStorage?: Storage }).localStorage
    }
  })

  it('formats money with the active language currency symbol', () => {
    act(() => {
      TestRenderer.create(
        <I18nProvider>
          <MoneyProbe />
        </I18nProvider>,
      )
    })

    act(() => setLangRef?.('en'))
    act(() => setLangRef?.('ko'))
    act(() => setLangRef?.('ja'))
    act(() => setLangRef?.('es'))
    act(() => setLangRef?.('zh'))

    expect(formattedByLang).toEqual({
      zh: '¥12.50',
      en: '$12.50',
      ko: '₩12.50',
      ja: '¥12.50',
      es: '€12.50',
    })
  })
})
