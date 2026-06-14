/* ============================================================
   Regression tests — YouView taster / family entry rows (S3b).

   Pins the pro-gating of the new management entries added to 我的:
   - PRO account: the "口味家人" (Tasters) and "家人的口味" (Family feed)
     rows render and push /tasters and /family respectively.
   - FREE account: both rows self-hide (consistent with TasterSwitcher
     hiding for free accounts) — free users never see management entries
     for personas they cannot own.
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
        taster_manage: 'Tasters',
        family_feed: 'Family tastes',
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

afterEach(() => {
  act(() => {
    mountedRenderers.forEach((r) => r.unmount())
  })
  mountedRenderers.length = 0
  jest.clearAllMocks()
})

describe('YouView — taster / family entries pro gating', () => {
  it('pro account shows taster + family rows that navigate to /tasters and /family', () => {
    mockUseAuth.mockReturnValue({
      user: { plan: 'pro', displayName: 'Pat', email: 'p@x.com' },
      signOut: jest.fn(),
      patchUser: jest.fn(),
    })
    const renderer = render()

    const tasterRows = rowWithTestID(renderer, 'taster-manage-row')
    const familyRows = rowWithTestID(renderer, 'family-feed-row')
    expect(tasterRows.length).toBeGreaterThan(0)
    expect(familyRows.length).toBeGreaterThan(0)

    act(() => tasterRows[0].props.onPress())
    expect(mockPush).toHaveBeenCalledWith('/tasters')

    act(() => familyRows[0].props.onPress())
    expect(mockPush).toHaveBeenCalledWith('/family')
  })

  it('free account hides both management entries', () => {
    mockUseAuth.mockReturnValue({
      user: { plan: 'free', displayName: 'Pat', email: 'p@x.com' },
      signOut: jest.fn(),
      patchUser: jest.fn(),
    })
    const renderer = render()

    expect(rowWithTestID(renderer, 'taster-manage-row')).toHaveLength(0)
    expect(rowWithTestID(renderer, 'family-feed-row')).toHaveLength(0)
    expect(mockPush).not.toHaveBeenCalledWith('/tasters')
    expect(mockPush).not.toHaveBeenCalledWith('/family')
  })
})
