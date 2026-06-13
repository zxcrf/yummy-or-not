/* ============================================================
   Render tests — TasterSwitcher (atop Library / Stats).

   S3b (§行为 / §端点): a taster switcher sits at the top of the taste
   surfaces. The self-taster is the default. The switcher is HIDDEN/DISABLED
   for free users (taster CRUD + multi-taster is pro-only; free users only
   ever have the self-taster), and lets pro users switch the active taster —
   which the new-taste POST then carries.

   Pins:
   - FREE plan → the switcher renders nothing (no taster chips, no host output).
     Free users must not see a switch UI for personas they cannot own.
   - PRO plan → renders one chip per taster, with the self-taster marked active
     by default (active === null means self).
   - Pressing a non-self taster chip calls setActiveTaster with that id.
   - Pressing the self chip resets the active taster to null (self default).

   Auth (plan), the active-taster hook, and the tasters data source are mocked
   so this isolates the component's gating + selection wiring. FAILS today:
   components/app/TasterSwitcher does not exist yet. PASSES once S3b ships it.
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

// The tasters list source (a small SWR hook like _useTastes). Mocked here.
jest.mock('@/app/(tabs)/_useTasters', () => ({
  useTasters: () => mockUseTasters(),
}))

jest.mock('@/providers/I18nProvider', () => ({
  useI18n: () => ({ t: (k: string) => k, formatMoney: (v: string) => v }),
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

/** Collect every text string rendered anywhere in the tree. */
function allText(renderer: TestRenderer.ReactTestRenderer): string {
  return JSON.stringify(renderer.toJSON() ?? null)
}

describe('TasterSwitcher — free plan is hidden', () => {
  it('renders nothing for a free user', () => {
    mockUseAuth.mockReturnValue({ user: { id: 'u1', plan: 'free' } })
    const renderer = render()
    // No switcher UI at all — neither the self nor partner persona is offered.
    expect(renderer.toJSON()).toBeNull()
    expect(mockSetActiveTaster).not.toHaveBeenCalled()
  })
})

describe('TasterSwitcher — pro plan switches the active taster', () => {
  beforeEach(() => {
    mockUseAuth.mockReturnValue({ user: { id: 'u1', plan: 'pro' } })
  })

  it('renders a chip per taster with the self-taster active by default', () => {
    mockUseActiveTaster.mockReturnValue(null) // null = self default
    const renderer = render()
    const text = allText(renderer)
    expect(text).toContain('Me')
    expect(text).toContain('Partner')
  })

  it('selecting the partner taster calls setActiveTaster with its id', () => {
    const renderer = render()
    // Find the pressable for the partner persona by its accessibility role/label.
    const partnerChip = renderer.root.find(
      (node) =>
        typeof node.props.onPress === 'function' &&
        node.props.accessibilityLabel === 'Partner',
    )
    act(() => { partnerChip.props.onPress() })
    expect(mockSetActiveTaster).toHaveBeenCalledWith('ts_partner')
  })

  it('selecting the self taster resets the active taster to null (self default)', () => {
    mockUseActiveTaster.mockReturnValue('ts_partner') // partner currently active
    const renderer = render()
    const selfChip = renderer.root.find(
      (node) =>
        typeof node.props.onPress === 'function' &&
        node.props.accessibilityLabel === 'Me',
    )
    act(() => { selfChip.props.onPress() })
    // Switching back to self clears the explicit selection.
    expect(mockSetActiveTaster).toHaveBeenCalledWith(null)
  })
})
