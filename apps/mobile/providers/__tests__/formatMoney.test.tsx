import TestRenderer, { act } from 'react-test-renderer'
import { Platform } from 'react-native'

import { I18nProvider, useI18n } from '../I18nProvider'
import type { Lang } from '@yon/shared'

const outputs: Record<string, string> = {}
let setLangRef: ((lang: Lang) => void) | null = null

function Probe() {
  const { lang, setLang, formatMoney } = useI18n()
  outputs[`${lang}:18.00`] = formatMoney('18.00')
  outputs[`${lang}:legacy`] = formatMoney('$18.00')
  outputs[`${lang}:5.8`] = formatMoney('5.8')
  outputs[`${lang}:empty`] = formatMoney('')
  setLangRef = setLang
  return null
}

describe('formatMoney', () => {
  const realOS = Platform.OS
  const realLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')

  beforeEach(() => {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'web' })
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: jest.fn(() => null),
        setItem: jest.fn(),
      },
    })
    Object.keys(outputs).forEach((key) => {
      delete outputs[key]
    })
    setLangRef = null
  })

  afterAll(() => {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: realOS })
    if (realLocalStorage) {
      Object.defineProperty(globalThis, 'localStorage', realLocalStorage)
    } else {
      delete (globalThis as { localStorage?: Storage }).localStorage
    }
  })

  it('formats currency by active language and handles legacy strings', () => {
    act(() => {
      TestRenderer.create(
        <I18nProvider>
          <Probe />
        </I18nProvider>,
      )
    })

    act(() => setLangRef?.('en'))
    act(() => setLangRef?.('zh'))

    expect(outputs['en:18.00']).toBe('$18')
    expect(outputs['zh:18.00']).toBe('¥18')
    expect(outputs['zh:legacy']).toBe('¥18')
    expect(outputs['zh:5.8']).toBe('¥5.80')
    expect(outputs['zh:empty']).toBe('')
  })
})
