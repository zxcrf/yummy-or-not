/* ============================================================
   StatsView animation tests.

   Coverage:
   1. Verdict tile AnimatedNumber renders the correct final count.
   2. Currency symbol is NOT inside the AnimatedNumber node (static sibling).
   3. Currency symbol IS rendered as a static sibling with testID.
   4. No crash on null→loaded stats transition.
   5. Saved amount AnimatedNumber shows the correct numeric value after load.
   6. Locale table — all 5 real locales + one synthetic suffix-symbol case.
   7. Reduced-motion: AnimatedNumber snaps to target without animating.
   8. Refresh old→new: saved amount updates on pull-to-refresh.
   ============================================================ */

import TestRenderer, { act } from 'react-test-renderer'
import { translate, LANG_CURRENCY, type Lang } from '@yon/shared'
import StatsView from '../StatsView'

// ---------------------------------------------------------------------------
// Mocks — pass through all real @yon/shared exports; stub only getStats.
// ---------------------------------------------------------------------------

jest.mock('@yon/shared', () => ({
  ...jest.requireActual('@yon/shared'),
  getStats: jest.fn(),
}))

const mockFormatMoney = jest.fn()
const mockT = jest.fn()

jest.mock('@/providers/I18nProvider', () => ({
  useI18n: () => ({
    lang: 'en',
    setLang: jest.fn(),
    formatMoney: (n: number) => mockFormatMoney(n),
    t: (key: string, vars?: Record<string, string | number>) => mockT(key, vars),
  }),
}))

jest.mock('@/components/ds', () => {
  const React = require('react')
  return {
    Card: ({ children, ...props }: { children: React.ReactNode }) =>
      React.createElement('View', props, children),
    Icon: () => null,
  }
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findTextNodes(renderer: TestRenderer.ReactTestRenderer) {
  return renderer.root.findAll((n) => (n.type as unknown) === 'Text')
}

function findByTestID(renderer: TestRenderer.ReactTestRenderer, testID: string) {
  return renderer.root.findAll(
    (n) => (n.type as unknown) === 'Text' && n.props.testID === testID,
  )
}

function makeTaste(verdict: 'yum' | 'meh' | 'nah', id: string) {
  return {
    id,
    name: 'item',
    place: '',
    price: '$1.00',
    verdict,
    tags: [],
    boughtCount: 1,
    date: 'today',
    notes: '',
    image: '',
    imageThumb: '',
    imageDisplay: '',
    imageKey: '',
    createdAt: '2026-01-01T00:00:00.000Z',
  }
}

function makeTasteList() {
  return [
    makeTaste('yum', 't1'),
    makeTaste('yum', 't2'),
    makeTaste('meh', 't3'),
    makeTaste('nah', 't4'),
  ]
}

// Real formatMoneyValue logic mirroring I18nProvider.tsx — used in locale table
// so each row tests against the actual symbol+format each locale produces.
function realFormatMoney(amount: number, lang: Lang): string {
  const { symbol } = LANG_CURRENCY[lang]
  return Number.isInteger(amount) ? `${symbol}${amount}` : `${symbol}${amount.toFixed(2)}`
}

// ---------------------------------------------------------------------------
// Default mock setup — en locale, getStats offline.
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks()
  const { getStats } = require('@yon/shared')
  getStats.mockRejectedValue(new Error('offline'))
  mockFormatMoney.mockImplementation((n: number) => realFormatMoney(n, 'en'))
  mockT.mockImplementation((key: string, vars?: Record<string, string | number>) =>
    translate('en', key, vars),
  )
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('StatsView AnimatedNumber', () => {

  // 1. Verdict tile counts
  it('renders the correct final count in each verdict tile', () => {
    let renderer!: TestRenderer.ReactTestRenderer
    act(() => {
      renderer = TestRenderer.create(<StatsView items={makeTasteList()} />)
    })

    const textContents = findTextNodes(renderer)
      .map((n) => n.props.children)
      .filter((c) => typeof c === 'string')

    expect(textContents).toContain('2') // yum count
    expect(textContents).toContain('1') // meh and nah counts
  })

  // 2. Currency symbol NOT inside AnimatedNumber
  it('currency symbol is NOT inside the AnimatedNumber node (testID=saved-animated-number)', () => {
    let renderer!: TestRenderer.ReactTestRenderer
    act(() => {
      renderer = TestRenderer.create(<StatsView items={[makeTaste('nah', 't1')]} />)
    })

    const animNodes = findByTestID(renderer, 'saved-animated-number')
    expect(animNodes.length).toBeGreaterThan(0)

    const displayText = animNodes[0].props.children
    if (typeof displayText === 'string') {
      expect(displayText).not.toMatch(/[$¥₩€]/)
    }
  })

  // 3. Currency symbol IS a static sibling
  it('currency symbol is rendered as a static sibling Text with testID=saved-currency-symbol', () => {
    let renderer!: TestRenderer.ReactTestRenderer
    act(() => {
      renderer = TestRenderer.create(<StatsView items={[makeTaste('nah', 't1')]} />)
    })

    const symbolNodes = findByTestID(renderer, 'saved-currency-symbol')
    expect(symbolNodes.length).toBeGreaterThanOrEqual(1)
    expect(symbolNodes[0].props.children).toBe('$')
  })

  // 4. No crash on null→loaded transition
  it('does not crash on null→loaded stats transition', async () => {
    const { getStats } = require('@yon/shared')
    getStats.mockResolvedValueOnce({
      yum: 5, meh: 3, nah: 2, total: 10, savedAmount: '12.50',
    })

    let renderer!: TestRenderer.ReactTestRenderer
    await act(async () => {
      renderer = TestRenderer.create(<StatsView items={[]} />)
    })

    expect(findTextNodes(renderer).length).toBeGreaterThan(0)
  })

  // 5. Saved AnimatedNumber correct numeric value after load
  it('saved AnimatedNumber shows correct numeric value after stats load', async () => {
    const { getStats } = require('@yon/shared')
    getStats.mockResolvedValueOnce({
      yum: 3, meh: 1, nah: 1, total: 5, savedAmount: '42',
    })

    let renderer!: TestRenderer.ReactTestRenderer
    await act(async () => {
      renderer = TestRenderer.create(<StatsView items={[]} />)
    })

    const animNodes = findByTestID(renderer, 'saved-animated-number')
    expect(animNodes.length).toBeGreaterThan(0)
    expect(animNodes[0].props.children).toBe('42')
  })

  // -------------------------------------------------------------------------
  // 6. Locale table
  //
  // Real locales: translate() and LANG_CURRENCY come from the actual @yon/shared
  // source (jest.requireActual), so these rows pin the real symbol and the real
  // sentence fragments produced by each locale's saved_amt template.
  //
  // All 5 current locales use prefix-symbol (formatMoneyValue always prefixes).
  // The synthetic-suffix row keeps one test for suffix-position symbol logic,
  // clearly labeled as synthetic since no real locale currently uses it.
  // -------------------------------------------------------------------------

  type LocaleRow = {
    label: string
    translateLang: Lang           // lang to pass to translate() for saved_amt
    formatMoneyOutput: string     // what formatMoney(3) returns for this locale
    expectedSymbol: string        // text in testID="saved-currency-symbol"
    expectedNumber: string        // text in testID="saved-animated-number"
    expectedSentencePre: string   // sentence text before the money block ('' if none)
    expectedSentencePost: string  // sentence text after the money block ('' if none)
  }

  const localeTable: LocaleRow[] = [
    // en: saved_amt = "{amt} saved"  →  sentencePre='', sentencePost=' saved'
    {
      label: 'en',
      translateLang: 'en',
      formatMoneyOutput: realFormatMoney(3, 'en'),   // '$3'
      expectedSymbol: '$',
      expectedNumber: '3',
      expectedSentencePre: '',
      expectedSentencePost: ' saved',
    },
    // zh: saved_amt = "省下 {amt}"   →  sentencePre='省下 ', sentencePost=''
    {
      label: 'zh',
      translateLang: 'zh',
      formatMoneyOutput: realFormatMoney(3, 'zh'),   // '¥3'
      expectedSymbol: '¥',
      expectedNumber: '3',
      expectedSentencePre: '省下 ',
      expectedSentencePost: '',
    },
    // ja: saved_amt = "{amt} 節約"   →  sentencePre='', sentencePost=' 節約'
    {
      label: 'ja',
      translateLang: 'ja',
      formatMoneyOutput: realFormatMoney(3, 'ja'),   // '¥3'
      expectedSymbol: '¥',
      expectedNumber: '3',
      expectedSentencePre: '',
      expectedSentencePost: ' 節約',
    },
    // ko: saved_amt = "{amt} 절약"   →  sentencePre='', sentencePost=' 절약'
    {
      label: 'ko',
      translateLang: 'ko',
      formatMoneyOutput: realFormatMoney(3, 'ko'),   // '₩3'
      expectedSymbol: '₩',
      expectedNumber: '3',
      expectedSentencePre: '',
      expectedSentencePost: ' 절약',
    },
    // es: saved_amt = "{amt} ahorrados"  →  sentencePre='', sentencePost=' ahorrados'
    {
      label: 'es',
      translateLang: 'es',
      formatMoneyOutput: realFormatMoney(3, 'es'),   // '€3'
      expectedSymbol: '€',
      expectedNumber: '3',
      expectedSentencePre: '',
      expectedSentencePost: ' ahorrados',
    },
    // SYNTHETIC: formatMoney returns suffix-symbol "3€". No real locale does
    // this today; the row validates that StatsView's split logic handles it.
    {
      label: 'synthetic-suffix "3€"',
      translateLang: 'en',           // reuse en sentence template
      formatMoneyOutput: '3€',
      expectedSymbol: '€',
      expectedNumber: '3',
      expectedSentencePre: '',
      expectedSentencePost: ' saved',
    },
  ]

  it.each(localeTable)(
    'locale $label: symbol="$expectedSymbol" static, number="$expectedNumber" animated',
    async ({
      translateLang, formatMoneyOutput,
      expectedSymbol, expectedNumber,
      expectedSentencePre, expectedSentencePost,
    }) => {
      mockT.mockImplementation((key: string, vars?: Record<string, string | number>) =>
        translate(translateLang, key, vars),
      )
      mockFormatMoney.mockImplementation(() => formatMoneyOutput)

      const { getStats } = require('@yon/shared')
      getStats.mockResolvedValueOnce({
        yum: 1, meh: 0, nah: 0, total: 1, savedAmount: '3',
      })

      let renderer!: TestRenderer.ReactTestRenderer
      await act(async () => {
        renderer = TestRenderer.create(<StatsView items={[]} />)
      })

      // Symbol node: contains only the currency symbol character.
      const symbolNodes = findByTestID(renderer, 'saved-currency-symbol')
      expect(symbolNodes.length).toBeGreaterThanOrEqual(1)
      expect(symbolNodes[0].props.children).toBe(expectedSymbol)

      // Animated number node: contains the number, no currency symbol.
      const animNodes = findByTestID(renderer, 'saved-animated-number')
      expect(animNodes.length).toBeGreaterThan(0)
      expect(animNodes[0].props.children).toBe(expectedNumber)
      expect(String(animNodes[0].props.children)).not.toMatch(/[$¥₩€]/)

      // Sentence fragments: pin actual translated text around the money block.
      const allTexts = findTextNodes(renderer)
        .map((n) => n.props.children as string)
        .filter((c) => typeof c === 'string')
      if (expectedSentencePre) expect(allTexts).toContain(expectedSentencePre)
      if (expectedSentencePost) expect(allTexts).toContain(expectedSentencePost)
    },
  )

  // 7. Reduced-motion: snaps to target immediately
  it('snaps to target value immediately when reduced-motion is enabled', async () => {
    const reanimated = require('react-native-reanimated')
    const originalUseReducedMotion = reanimated.useReducedMotion
    reanimated.useReducedMotion = () => true

    const { getStats } = require('@yon/shared')
    getStats.mockResolvedValueOnce({
      yum: 7, meh: 2, nah: 1, total: 10, savedAmount: '99',
    })

    let renderer!: TestRenderer.ReactTestRenderer
    await act(async () => {
      renderer = TestRenderer.create(<StatsView items={[]} />)
    })

    const textContents = findTextNodes(renderer)
      .map((n) => n.props.children)
      .filter((c) => typeof c === 'string')
    expect(textContents).toContain('7')

    const animNodes = findByTestID(renderer, 'saved-animated-number')
    expect(animNodes.length).toBeGreaterThan(0)
    expect(animNodes[0].props.children).toBe('99')

    reanimated.useReducedMotion = originalUseReducedMotion
  })

  // 8. Refresh old→new: saved amount updates after pull-to-refresh
  it('updates saved amount after pull-to-refresh delivers new stats', async () => {
    const { getStats } = require('@yon/shared')
    getStats.mockResolvedValueOnce({
      yum: 1, meh: 0, nah: 0, total: 1, savedAmount: '5',
    })

    const onRefresh = jest.fn().mockResolvedValue(undefined)
    let renderer!: TestRenderer.ReactTestRenderer
    await act(async () => {
      renderer = TestRenderer.create(
        <StatsView items={[makeTaste('yum', 't1')]} onRefresh={onRefresh} />,
      )
    })

    let animNodes = findByTestID(renderer, 'saved-animated-number')
    expect(animNodes[0].props.children).toBe('5')

    getStats.mockResolvedValueOnce({
      yum: 2, meh: 0, nah: 0, total: 2, savedAmount: '20',
    })

    const scrollView = renderer.root.find(
      (n) => (n.type as unknown) === 'ScrollView',
    )
    await act(async () => {
      await scrollView.props.refreshControl.props.onRefresh()
    })

    animNodes = findByTestID(renderer, 'saved-animated-number')
    expect(animNodes[0].props.children).toBe('20')
    expect(onRefresh).toHaveBeenCalledTimes(1)
    expect(getStats).toHaveBeenCalledTimes(2)
  })
})
