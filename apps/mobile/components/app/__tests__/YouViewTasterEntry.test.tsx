/* ============================================================
   Regression tests — YouView merged "家人" entry (S3b).

   The two former rows — taster-manage (口味家人 → /tasters) and family-feed
   (家人的口味 → /family) — were merged into a SINGLE "家人" entry that pushes
   /family (the merged member-list + per-member tastes screen). Pins:
   - PRO account: exactly ONE "家人" row (family-entry-row) renders and
     pushes /family; the two OLD rows (taster-manage-row, family-feed-row)
     are GONE.
   - FREE account: the merged entry self-hides (consistent with
     TasterSwitcher hiding for free accounts).
   ============================================================ */

import TestRenderer, { act } from 'react-test-renderer'

const mockPush = jest.fn()
const mockUseAuth = jest.fn()

jest.mock('@yon/shared', () => ({
  LANGS: [{ code: 'zh', label: 'Chinese', native: '中文' }],
  updateUser: jest.fn(),
}))

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
}))

jest.mock('@/providers/I18nProvider', () => ({
  useI18n: () => ({
    lang: 'zh',
    setLang: jest.fn(),
    formatMoney: (n: number) => `¥${n}`,
    t: (key: string, vars?: Record<string, string | number>) => {
      const map: Record<string, string> = {
        family_entry: '家人',
        tag_manage: 'Tag library',
      }
      if (key === 'tastes_logged') return `${vars?.n} logged`
      if (key === 'saved_amt') return `${vars?.amt} saved`
      return map[key] ?? key
    },
  }),
}))

jest.mock('@/app/(tabs)/_useTags', () => ({
  useTags: () => ({ tags: [], loading: false }),
  invalidateTagsCache: jest.fn(),
}))

import YouView from '../YouView'

jest.mock('@/providers/AuthProvider', () => ({
  useAuth: () => mockUseAuth(),
}))

const mountedRenderers: TestRenderer.ReactTestRenderer[] = []

function render(): TestRenderer.ReactTestRenderer {
  let renderer!: TestRenderer.ReactTestRenderer
  act(() => {
    renderer = TestRenderer.create(<YouView items={[]} />)
  })
  mountedRenderers.push(renderer)
  return renderer
}

function rowWithTestID(renderer: TestRenderer.ReactTestRenderer, testID: string) {
  return renderer.root.findAll(
    (node) => node.props.testID === testID && typeof node.props.onPress === 'function',
  )
}

/** Collapse host/composite duplicates of the same testID to one logical row. */
function uniqueRowCount(renderer: TestRenderer.ReactTestRenderer, testID: string): number {
  return rowWithTestID(renderer, testID).length > 0 ? 1 : 0
}

afterEach(() => {
  act(() => {
    mountedRenderers.forEach((r) => r.unmount())
  })
  mountedRenderers.length = 0
  jest.clearAllMocks()
})

describe('YouView — merged 家人 entry pro gating', () => {
  it('pro account shows ONE merged 家人 row that navigates to /family; the two old rows are gone', () => {
    mockUseAuth.mockReturnValue({
      user: { plan: 'pro', displayName: 'Pat', email: 'p@x.com' },
      signOut: jest.fn(),
      patchUser: jest.fn(),
    })
    const renderer = render()

    // Exactly ONE merged entry exists…
    const familyRows = rowWithTestID(renderer, 'family-entry-row')
    expect(familyRows.length).toBeGreaterThan(0)
    expect(uniqueRowCount(renderer, 'family-entry-row')).toBe(1)

    // …and the two OLD separate rows are gone.
    expect(rowWithTestID(renderer, 'taster-manage-row')).toHaveLength(0)
    expect(rowWithTestID(renderer, 'family-feed-row')).toHaveLength(0)

    act(() => familyRows[0].props.onPress())
    expect(mockPush).toHaveBeenCalledWith('/family')
    // The merged screen is the only family destination — never the dropped /tasters.
    expect(mockPush).not.toHaveBeenCalledWith('/tasters')
  })

  it('free account hides the merged entry', () => {
    mockUseAuth.mockReturnValue({
      user: { plan: 'free', displayName: 'Pat', email: 'p@x.com' },
      signOut: jest.fn(),
      patchUser: jest.fn(),
    })
    const renderer = render()

    expect(rowWithTestID(renderer, 'family-entry-row')).toHaveLength(0)
    expect(rowWithTestID(renderer, 'taster-manage-row')).toHaveLength(0)
    expect(rowWithTestID(renderer, 'family-feed-row')).toHaveLength(0)
    expect(mockPush).not.toHaveBeenCalledWith('/family')
  })
})
