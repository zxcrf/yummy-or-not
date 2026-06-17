/* ============================================================
   RED tests — TasterSwitcher redesign (plan 5: right-top avatar + sheet + banner)

   Pins the THREE required behaviors of the NEW design:

   1. PRO multi-taster → right-top avatar bubble (first letter) + chevron;
      NO old horizontal pills/ScrollView row; tapping opens a bottom sheet
      listing all tasters (current one checked); selecting a non-self taster
      calls setActiveTaster with that id.

   2. free / single-taster → avatar bubble only (no chevron, no sheet trigger).

   3. Banner: when a non-self taster is active, TasterSwitcher exposes a
      `testID="viewing-banner"` node containing the taster's displayName.
      When self (active === null), NO banner node is rendered.

   All three assertions FAIL against the current pills-based implementation
   because:
   - (1) the old code renders a horizontal ScrollView with chip Pressables;
         there is no avatar bubble (`testID="taster-avatar"`) or chevron.
   - (2) same — no avatar, no chevron absent.
   - (3) the old code renders nothing for free/single AND has no banner node
         for the PRO multi-taster active-non-self case.

   PASSES once the designer agent ships the new TasterSwitcher.
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
    t: (k: string, params?: Record<string, string>) => {
      if (params) return `${k}:${JSON.stringify(params)}`
      return k
    },
    formatMoney: (v: string) => v,
  }),
}))

import TasterSwitcher from '../TasterSwitcher'

const SELF = { id: 'ts_self', displayName: 'Wynston', isSelf: true }
const PARTNER = { id: 'ts_partner', displayName: 'bogi', isSelf: false }

beforeEach(() => {
  jest.clearAllMocks()
  mockUseActiveTaster.mockReturnValue(null)
  mockUseTasters.mockReturnValue({ tasters: [SELF, PARTNER], loading: false })
})

function render(): TestRenderer.ReactTestRenderer {
  let renderer!: TestRenderer.ReactTestRenderer
  act(() => {
    renderer = TestRenderer.create(<TasterSwitcher />)
  })
  return renderer
}

// ── 1. PRO multi-taster: avatar + chevron, no old pills row ────────────────

describe('TasterSwitcher redesign — PRO multi-taster: avatar + chevron in top-right', () => {
  beforeEach(() => {
    mockUseAuth.mockReturnValue({ user: { id: 'u1', plan: 'pro' } })
  })

  it('renders a taster-avatar element (the right-top avatar bubble)', () => {
    const renderer = render()
    // The new design exposes testID="taster-avatar" for the right-top circle.
    // The old pills/ScrollView design has NO such element → this FAILS today.
    const avatarNode = renderer.root.findAll(
      (node) => node.props.testID === 'taster-avatar',
    )
    expect(avatarNode.length).toBeGreaterThan(0)
  })

  it('renders a chevron element alongside the avatar (multi-taster only)', () => {
    const renderer = render()
    // The new design exposes testID="taster-chevron" to indicate tappability.
    // The old design has no such element → FAILS today.
    const chevronNodes = renderer.root.findAll(
      (node) => node.props.testID === 'taster-chevron',
    )
    expect(chevronNodes.length).toBeGreaterThan(0)
  })

  it('does NOT render the old horizontal pills/ScrollView switcher row', () => {
    const renderer = render()
    // Old design used accessibilityLabel="taster-switcher" on a ScrollView.
    // New design removes this row entirely — it must NOT appear.
    // This FAILS against the current code which still renders the pills row.
    const oldPillsRow = renderer.root.findAll(
      (node) => node.props.accessibilityLabel === 'taster-switcher',
    )
    expect(oldPillsRow.length).toBe(0)
  })

  it('tapping the avatar opens a sheet that lists all tasters', () => {
    const renderer = render()
    // The sheet is controlled via testID="taster-sheet-open" pressable.
    const trigger = renderer.root.find(
      (node) => node.props.testID === 'taster-sheet-open',
    )
    // Must exist — FAILS today (old code has no such element).
    expect(trigger).toBeTruthy()

    // After pressing, the sheet should become visible (testID="taster-sheet").
    act(() => { trigger.props.onPress() })
    const sheet = renderer.root.find(
      (node) => node.props.testID === 'taster-sheet',
    )
    expect(sheet).toBeTruthy()
  })

  it('selecting a non-self taster in the sheet calls setActiveTaster with that id', () => {
    const renderer = render()

    // Open the sheet first.
    const trigger = renderer.root.find(
      (node) => node.props.testID === 'taster-sheet-open',
    )
    act(() => { trigger.props.onPress() })

    // Find and press the row for PARTNER inside the open sheet.
    const partnerRow = renderer.root.find(
      (node) =>
        node.props.testID === `taster-row-${PARTNER.id}`,
    )
    act(() => { partnerRow.props.onPress() })

    expect(mockSetActiveTaster).toHaveBeenCalledWith(PARTNER.id)
  })

  it('selecting the self taster in the sheet calls setActiveTaster with null', () => {
    mockUseActiveTaster.mockReturnValue(PARTNER.id) // partner currently active
    const renderer = render()

    const trigger = renderer.root.find(
      (node) => node.props.testID === 'taster-sheet-open',
    )
    act(() => { trigger.props.onPress() })

    const selfRow = renderer.root.find(
      (node) => node.props.testID === `taster-row-${SELF.id}`,
    )
    act(() => { selfRow.props.onPress() })

    // Self selection must pass null (back to self default).
    expect(mockSetActiveTaster).toHaveBeenCalledWith(null)
  })
})

// ── 2. Banner: appears for non-self active taster, absent for self ──────────

describe('TasterSwitcher redesign — banner for non-self active taster', () => {
  beforeEach(() => {
    mockUseAuth.mockReturnValue({ user: { id: 'u1', plan: 'pro' } })
  })

  it('shows a viewing-banner with the taster name when a non-self taster is active', () => {
    mockUseActiveTaster.mockReturnValue(PARTNER.id)
    const renderer = render()

    // New design renders testID="viewing-banner" when a non-self taster is active.
    // FAILS today: old code has no such element.
    const banner = renderer.root.find(
      (node) => node.props.testID === 'viewing-banner',
    )
    expect(banner).toBeTruthy()

    // The banner must contain the active taster's displayName somewhere in its
    // rendered tree. We stringify the full renderer output and check for the
    // name — avoids per-node .toJSON() which is non-standard and required an
    // unauthorized prototype patch.
    const fullJson = JSON.stringify(renderer.toJSON())
    expect(fullJson).toContain(PARTNER.displayName)
  })

  it('does NOT show the viewing-banner when self is active (active === null)', () => {
    mockUseActiveTaster.mockReturnValue(null) // self
    const renderer = render()

    const banners = renderer.root.findAll(
      (node) => node.props.testID === 'viewing-banner',
    )
    // No banner when viewing own tastes.
    expect(banners.length).toBe(0)
  })
})

// ── 3. free / single-taster: avatar only, no chevron ──────────────────────

describe('TasterSwitcher redesign — free or single-taster: avatar only, no chevron', () => {
  it('free plan with multiple tasters: renders avatar but NO chevron', () => {
    mockUseAuth.mockReturnValue({ user: { id: 'u1', plan: 'free' } })
    // Two tasters returned but user is free — chevron must NOT appear (PRO gate).
    mockUseTasters.mockReturnValue({ tasters: [SELF, PARTNER], loading: false })
    const renderer = render()

    // Old code returned null for free → no avatar at all → this FAILS today.
    const avatarNodes = renderer.root.findAll(
      (node) => node.props.testID === 'taster-avatar',
    )
    expect(avatarNodes.length).toBeGreaterThan(0)

    // No chevron for free/single.
    const chevronNodes = renderer.root.findAll(
      (node) => node.props.testID === 'taster-chevron',
    )
    expect(chevronNodes.length).toBe(0)
  })

  it('pro plan with only one taster (self): avatar but NO chevron', () => {
    mockUseAuth.mockReturnValue({ user: { id: 'u1', plan: 'pro' } })
    mockUseTasters.mockReturnValue({ tasters: [SELF], loading: false })
    const renderer = render()

    const avatarNodes = renderer.root.findAll(
      (node) => node.props.testID === 'taster-avatar',
    )
    expect(avatarNodes.length).toBeGreaterThan(0)

    const chevronNodes = renderer.root.findAll(
      (node) => node.props.testID === 'taster-chevron',
    )
    expect(chevronNodes.length).toBe(0)
  })
})
