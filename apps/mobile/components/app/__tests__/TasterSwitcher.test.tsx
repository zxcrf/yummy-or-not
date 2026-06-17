/* ============================================================
   Render tests — TasterSwitcher (plan 5 redesign: right-top avatar + sheet + banner).

   Updated from the old pills-row design to the new avatar + bottom-sheet design.

   Pins:
   - All users (free or pro) always see an avatar bubble.
   - Multi-taster PRO users see a chevron and can open a bottom sheet.
   - Free / single-taster users see the avatar only (no chevron, no sheet).
   - Pressing a non-self taster row in the sheet calls setActiveTaster with that id.
   - Pressing the self taster row resets the active taster to null.
   - Banner appears for non-self active taster; absent when self is active.
   ============================================================ */

import TestRenderer, { act } from 'react-test-renderer'

const mockUseAuth = jest.fn()
const mockUseActiveTaster = jest.fn<string | null, []>()
const mockSetActiveTaster = jest.fn()
const mockUseTasters = jest.fn()

jest.mock('@/providers/AuthProvider', () => ({
  useAuth: () => mockUseAuth(),
}))

jest.mock('@/app/(tabs)/_useActiveTaster', () => ({
  useActiveTaster: () => mockUseActiveTaster(),
  setActiveTaster: (...args: unknown[]) => mockSetActiveTaster(...args),
}))

jest.mock('@/app/(tabs)/_useTasters', () => ({
  useTasters: () => mockUseTasters(),
}))

jest.mock('@/providers/I18nProvider', () => ({
  useI18n: () => ({
    t: (k: string, params?: Record<string, string>) =>
      params ? `${k}:${JSON.stringify(params)}` : k,
    formatMoney: (v: string) => v,
  }),
}))

import TasterSwitcher from '../TasterSwitcher'

const SELF = { id: 'ts_self', displayName: 'Me', isSelf: true }
const PARTNER = { id: 'ts_partner', displayName: 'Partner', isSelf: false }

beforeEach(() => {
  jest.clearAllMocks()
  mockUseActiveTaster.mockReturnValue(null) // default: self
  mockUseTasters.mockReturnValue({ tasters: [SELF, PARTNER], loading: false })
})

function render(): TestRenderer.ReactTestRenderer {
  let renderer!: TestRenderer.ReactTestRenderer
  act(() => {
    renderer = TestRenderer.create(<TasterSwitcher />)
  })
  return renderer
}

describe('TasterSwitcher — free plan shows avatar only (no chevron)', () => {
  it('renders an avatar for a free user', () => {
    mockUseAuth.mockReturnValue({ user: { id: 'u1', plan: 'free' } })
    mockUseTasters.mockReturnValue({ tasters: [SELF], loading: false })
    const renderer = render()
    // New design: free users always see their own avatar.
    const avatarNodes = renderer.root.findAll(
      (node) => node.props.testID === 'taster-avatar',
    )
    expect(avatarNodes.length).toBeGreaterThan(0)
  })

  it('does NOT render a chevron for a free user (single taster)', () => {
    mockUseAuth.mockReturnValue({ user: { id: 'u1', plan: 'free' } })
    mockUseTasters.mockReturnValue({ tasters: [SELF], loading: false })
    const renderer = render()
    const chevronNodes = renderer.root.findAll(
      (node) => node.props.testID === 'taster-chevron',
    )
    expect(chevronNodes.length).toBe(0)
  })
})

describe('TasterSwitcher — pro plan: avatar + chevron + sheet switching', () => {
  beforeEach(() => {
    mockUseAuth.mockReturnValue({ user: { id: 'u1', plan: 'pro' } })
  })

  it('renders an avatar and chevron for a pro user with multiple tasters', () => {
    const renderer = render()
    const avatarNodes = renderer.root.findAll(
      (node) => node.props.testID === 'taster-avatar',
    )
    expect(avatarNodes.length).toBeGreaterThan(0)

    const chevronNodes = renderer.root.findAll(
      (node) => node.props.testID === 'taster-chevron',
    )
    expect(chevronNodes.length).toBeGreaterThan(0)
  })

  it('selecting the partner taster in the sheet calls setActiveTaster with its id', () => {
    const renderer = render()

    // Open the sheet first.
    const trigger = renderer.root.find(
      (node) => node.props.testID === 'taster-sheet-open',
    )
    act(() => { trigger.props.onPress() })

    // Find the partner row and press it.
    const partnerRow = renderer.root.find(
      (node) => node.props.testID === `taster-row-${PARTNER.id}`,
    )
    act(() => { partnerRow.props.onPress() })

    expect(mockSetActiveTaster).toHaveBeenCalledWith('ts_partner')
  })

  it('selecting the self taster in the sheet resets the active taster to null', () => {
    mockUseActiveTaster.mockReturnValue('ts_partner') // partner currently active
    const renderer = render()

    const trigger = renderer.root.find(
      (node) => node.props.testID === 'taster-sheet-open',
    )
    act(() => { trigger.props.onPress() })

    const selfRow = renderer.root.find(
      (node) => node.props.testID === `taster-row-${SELF.id}`,
    )
    act(() => { selfRow.props.onPress() })

    // Switching back to self clears the explicit selection.
    expect(mockSetActiveTaster).toHaveBeenCalledWith(null)
  })
})

// Bug fix (2026-06-17): the "正在查看 X 的口味" banner was removed from
// TasterSwitcher. The top-right avatar already tells the user which taster
// they're viewing, and rendering a banner here ALSO duplicated the one the
// route/page header rendered. TasterSwitcher must now render NO banner.
describe('TasterSwitcher — renders no viewing-banner (moved out of the component)', () => {
  beforeEach(() => {
    mockUseAuth.mockReturnValue({ user: { id: 'u1', plan: 'pro' } })
  })

  it('does NOT render a viewing-banner when a non-self taster is active', () => {
    mockUseActiveTaster.mockReturnValue(PARTNER.id)
    const renderer = render()
    expect(
      renderer.root.findAll((node) => node.props.testID === 'viewing-banner'),
    ).toHaveLength(0)
  })

  it('does NOT render a viewing-banner when self is active (active === null)', () => {
    mockUseActiveTaster.mockReturnValue(null)
    const renderer = render()
    expect(
      renderer.root.findAll((node) => node.props.testID === 'viewing-banner'),
    ).toHaveLength(0)
  })
})
