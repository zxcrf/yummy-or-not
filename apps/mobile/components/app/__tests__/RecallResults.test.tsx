/* ============================================================
   Regression tests — RecallResults (the recall/decision surface that
   Library renders when a search query is active). Pins:
   1. Notes-only matches still surface (searchTastes covers notes).
   2. Ranked order: name-match ranks above a notes-only match.
   3. Multi-result: top verdict card + "Other matches" group.
   4. Single result: no "Other matches" header.
   5. Repurchase warning styling honours warnBeforeBuy + warningsEnabled.
   6. Big verdict headline lineHeight >= fontSize (no label overlap).
   7. No-record empty state when nothing matches.
   8. Tapping a result row routes to /taste/[id].

   Uses the REAL searchTastes so ranking/notes behaviour is exercised end
   to end — only the platform/DS/provider edges are mocked.
   ============================================================ */

import TestRenderer, { act } from 'react-test-renderer'
import { RecallResults } from '../RecallResults'
import type { Taste } from '@yon/shared'

// ---- mock shared (keep the real searchTastes) ---------------------------

jest.mock('@yon/shared', () => jest.requireActual('@yon/shared'))

// ---- mock useAuth -------------------------------------------------------

let mockUser: { warningsEnabled: boolean } | null = { warningsEnabled: true }
jest.mock('@/providers/AuthProvider', () => ({
  useAuth: () => ({ user: mockUser }),
}))

// ---- mock expo-router ---------------------------------------------------

const mockPush = jest.fn()
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
}))

// ---- mock i18n ----------------------------------------------------------

jest.mock('@/providers/I18nProvider', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string>) => {
      const map: Record<string, string> = {
        verdict_on_file: 'Verdict on file',
        loved_it: 'You loved it',
        soso: 'It was so-so',
        skip_it: 'You said skip it',
        no_record: params ? `No record of "${params.q}".` : 'No record.',
        try_then_log: 'Try it, then log.',
        log_it_now: 'Log it now',
        recall_other_matches: 'Other matches',
        recall_warn_skip: 'You marked this ×_× NAH last time — skip it',
        v_yum: 'YUM', v_meh: 'MEH', v_nah: 'NAH',
      }
      return map[key] ?? key
    },
  }),
}))

// ---- mock ds components -------------------------------------------------

jest.mock('@/components/ds', () => ({
  Button: ({ children, onPress }: { children: React.ReactNode; onPress?: () => void }) => (
    <button onClick={onPress}>{children}</button>
  ),
  Card: ({ children, variant, padded }: { children: React.ReactNode; variant?: string; padded?: boolean }) => (
    <div data-variant={variant} data-padded={padded}>{children}</div>
  ),
  Icon: ({ name }: { name: string }) => <span data-icon={name} />,
  VerdictStamp: ({ verdict, label }: { verdict: string; label: string }) => (
    <span data-verdict={verdict}>{label}</span>
  ),
}))

// ---- mock expo-image ----------------------------------------------------

jest.mock('expo-image', () => ({ Image: () => null }))

// ---- helpers ------------------------------------------------------------

let seq = 0
function taste(overrides: Partial<Taste> & { name: string }): Taste {
  return {
    id: String(++seq),
    place: 'Somewhere',
    price: '',
    status: 'tasted',
    verdict: 'yum',
    tags: [],
    boughtCount: 1,
    warnBeforeBuy: false,
    purchases: [],
    date: '2 days ago',
    notes: '',
    image: '',
    imageThumb: '',
    imageDisplay: '',
    imageKey: '',
    createdAt: '2026-06-11T00:00:00.000Z',
    ...overrides,
  }
}

function renderResults(pool: Taste[], query: string) {
  let renderer!: TestRenderer.ReactTestRenderer
  act(() => {
    renderer = TestRenderer.create(<RecallResults pool={pool} query={query} />)
  })
  return renderer
}

function textNodes(renderer: TestRenderer.ReactTestRenderer, text: string) {
  return renderer.root.findAll(
    (n) =>
      String(n.type) === 'Text' &&
      typeof n.props.children === 'string' &&
      n.props.children === text,
  )
}

function flattenStyle(style: unknown): Record<string, number> {
  if (Array.isArray(style)) return Object.assign({}, ...style.map(flattenStyle))
  return (style as Record<string, number>) ?? {}
}

// ---- tests --------------------------------------------------------------

describe('RecallResults', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockUser = { warningsEnabled: true }
  })

  it('surfaces a notes-only match (regression: notes must be searched)', () => {
    const pool = [taste({ name: 'Mystery Drink', notes: 'jasmine flavor' })]
    const renderer = renderResults(pool, 'jasmine')
    expect(textNodes(renderer, 'Mystery Drink')).toHaveLength(1)
  })

  it('ranks a name-match above a notes-only match', () => {
    const pool = [
      taste({ name: 'latte macchiato', notes: '' }),
      taste({ name: 'Random Drink', notes: 'tastes like a latte' }),
    ]
    const renderer = renderResults(pool, 'latte')

    expect(textNodes(renderer, 'latte macchiato')).toHaveLength(1)
    expect(textNodes(renderer, 'Random Drink')).toHaveLength(1)

    const allText = renderer.root
      .findAll((n) => String(n.type) === 'Text' && typeof n.props.children === 'string')
      .map((n) => n.props.children as string)
    expect(allText.indexOf('latte macchiato')).toBeLessThan(allText.indexOf('Random Drink'))
  })

  it('shows the top verdict card and an "Other matches" group for multiple hits', () => {
    const pool = [
      taste({ name: 'Matcha latte', verdict: 'yum' }),
      taste({ name: 'Matcha smoothie', verdict: 'meh' }),
    ]
    const renderer = renderResults(pool, 'matcha')

    expect(textNodes(renderer, 'Verdict on file')).toHaveLength(1)
    expect(textNodes(renderer, 'You loved it')).toHaveLength(1)
    expect(textNodes(renderer, 'Other matches')).toHaveLength(1)
    expect(textNodes(renderer, 'Matcha smoothie').length).toBeGreaterThan(0)
  })

  it('does NOT render "Other matches" when there is a single hit', () => {
    const pool = [taste({ name: 'Boba' })]
    const renderer = renderResults(pool, 'boba')
    expect(textNodes(renderer, 'Other matches')).toHaveLength(0)
  })

  it('the big verdict headline lineHeight is >= its fontSize (no label overlap)', () => {
    const pool = [taste({ name: 'Matcha latte', verdict: 'yum' })]
    const renderer = renderResults(pool, 'matcha')

    const headline = textNodes(renderer, 'You loved it')
    expect(headline).toHaveLength(1)
    const style = flattenStyle(headline[0]!.props.style)
    expect(style.fontSize).toBe(46)
    expect(typeof style.lineHeight).toBe('number')
    expect(style.lineHeight).toBeGreaterThanOrEqual(style.fontSize)
  })

  it('shows warn styling when warnBeforeBuy=true and warningsEnabled=true', () => {
    mockUser = { warningsEnabled: true }
    const pool = [taste({ name: 'Matcha', verdict: 'nah', warnBeforeBuy: true })]
    const renderer = renderResults(pool, 'matcha')

    expect(textNodes(renderer, 'You marked this ×_× NAH last time — skip it')).toHaveLength(1)
    // The big headline verdict word must be replaced by the warn banner.
    const bigSkip = renderer.root.findAll(
      (n) =>
        String(n.type) === 'Text' &&
        n.props.children === 'You said skip it' &&
        flattenStyle(n.props.style).fontSize >= 40,
    )
    expect(bigSkip).toHaveLength(0)
  })

  it('shows plain verdict (no warn) when warningsEnabled=false even if warnBeforeBuy=true', () => {
    mockUser = { warningsEnabled: false }
    const pool = [taste({ name: 'Matcha', verdict: 'nah', warnBeforeBuy: true })]
    const renderer = renderResults(pool, 'matcha')

    expect(textNodes(renderer, 'You marked this ×_× NAH last time — skip it')).toHaveLength(0)
    expect(textNodes(renderer, 'You said skip it')).toHaveLength(1)
  })

  it('shows the no-record empty state when nothing matches', () => {
    const pool = [taste({ name: 'Boba' })]
    const renderer = renderResults(pool, 'zzzznotathing')

    expect(textNodes(renderer, 'No record of "zzzznotathing".')).toHaveLength(1)
    const logButtons = renderer.root.findAll((n) => n.props.children === 'Log it now')
    expect(logButtons.length).toBeGreaterThan(0)
  })

  it('tapping a result row routes to its detail screen', () => {
    const pool = [taste({ id: 'tap-me', name: 'Boba' })]
    const renderer = renderResults(pool, 'boba')

    const row = renderer.root.find(
      (n) => n.props.accessibilityRole === 'button' && typeof n.props.onPress === 'function',
    )
    act(() => {
      row.props.onPress()
    })
    expect(mockPush).toHaveBeenCalledWith('/taste/tap-me')
  })
})
