/* ============================================================
   Regression test — AddModal tags a new taste with the active taster (S3b).

   §S3b: "POST /api/tastes 带 taster_id；不带则落 self-taster." The mobile
   AddModal must thread the CLIENT active taster (useActiveTaster) into the
   createTaste payload so a record logged while a non-self taster is active is
   attributed to that persona.

   Pins:
   - When a non-self taster is active, Save calls createTaste with that
     tasterId in the payload.
   - When the active taster is null (self default), Save sends no tasterId
     (so the server applies the self-taster default — never a wrong persona).

   Mirrors the AddModalTodo harness. FAILS today: AddModal does not read
   useActiveTaster nor include tasterId. PASSES once S3b wires it in.
   ============================================================ */

import TestRenderer, { act } from 'react-test-renderer'
import AddModal from '../AddModal'

// ---- mock react-native ----------------------------------------------------

jest.mock('react-native', () => {
  const actual = jest.requireActual('react-native')
  return new Proxy(actual, {
    get(target, prop, receiver) {
      if (prop === 'KeyboardAvoidingView') {
        return ({ children }: { children: React.ReactNode }) => children
      }
      if (prop === 'ScrollView') {
        return ({ children }: { children: React.ReactNode }) => (
          <div>{children}</div>
        )
      }
      return Reflect.get(target, prop, receiver)
    },
  })
})

// ---- mock shared ----------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockCreateTaste = jest.fn<any, any[]>()
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockSearchTastes = jest.fn<any, any[]>(() => [])
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockCreateTag = jest.fn<any, any[]>()
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockReverseGeocode = jest.fn<any, any[]>()

jest.mock('@yon/shared', () => ({
  TAG_CHOICES: ['Coffee', 'Boba'],
  createTaste: (a: unknown, b: unknown) => mockCreateTaste(a, b),
  createTag: (a: unknown) => mockCreateTag(a),
  reverseGeocode: (a: unknown, b: unknown) => mockReverseGeocode(a, b),
  searchTastes: (a: unknown) => mockSearchTastes(a),
}))

// ---- mock _useTastes / _useTags / _useActiveTaster ------------------------

jest.mock('@/app/(tabs)/_useTastes', () => ({
  invalidateTastes: jest.fn(),
  useRefreshableTastes: () => ({ items: [] }),
}))

jest.mock('@/app/(tabs)/_useTags', () => ({
  invalidateTagsCache: jest.fn(),
  useTags: () => ({ tags: [] }),
}))

const mockUseActiveTaster = jest.fn<string | null, []>(() => null)
jest.mock('@/app/(tabs)/_useActiveTaster', () => ({
  useActiveTaster: () => mockUseActiveTaster(),
}))

// The Add screen now reads the taster list to render the attribution selector.
// Provide a self + one family persona so the selector is present; the default
// attribution still mirrors the active taster (asserted below).
jest.mock('@/app/(tabs)/_useTasters', () => ({
  useTasters: () => ({
    tasters: [
      { id: 'ts_self', isSelf: true, displayName: 'You' },
      { id: 'ts_partner', isSelf: false, displayName: 'Partner' },
    ],
    loading: false,
  }),
}))

// ---- mock providers -------------------------------------------------------

jest.mock('@/providers/I18nProvider', () => ({
  useI18n: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        f_what: 'What?',
        save_taste_web: 'Save',
        v_yum: 'YUM', v_meh: 'MEH', v_nah: 'NAH',
      }
      return map[key] ?? key
    },
  }),
}))

jest.mock('@/providers/AuthProvider', () => ({
  useAuth: () => ({ user: { plan: 'pro', warningsEnabled: true, locationEnabled: false } }),
}))

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn() }),
}))

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 47, bottom: 0, left: 0, right: 0 }),
}))

jest.mock('expo-image-picker', () => ({}))
jest.mock('expo-location', () => ({}))
jest.mock('expo-image-manipulator', () => ({}))
jest.mock('react-native-reanimated', () => ({
  FadeIn: { duration: () => ({}) },
  FadeOut: { duration: () => ({}) },
  default: { View: ({ children }: { children: React.ReactNode }) => children },
}))

// ---- mock ds components ---------------------------------------------------

jest.mock('@/components/ds', () => ({
  Button: ({ children, onPress, disabled, testID }: {
    children: React.ReactNode; onPress?: () => void; disabled?: boolean; testID?: string
  }) => (
    <button onClick={onPress} disabled={disabled} data-testid={testID}>{children}</button>
  ),
  EditActionHeader: ({ title, cancelLabel, onCancel, primaryLabel, onPrimary, primaryDisabled, primaryTestID }: {
    title: string; cancelLabel: string; onCancel?: () => void; primaryLabel: string
    onPrimary?: () => void; primaryDisabled?: boolean; primaryTestID?: string
  }) => (
    <>
      <button onClick={onCancel}>{cancelLabel}</button>
      <span>{title}</span>
      <button onClick={onPrimary} disabled={primaryDisabled} data-testid={primaryTestID}>{primaryLabel}</button>
    </>
  ),
  Icon: ({ name }: { name: string }) => <span data-icon={name} />,
  IconButton: ({ children, onPress }: { children: React.ReactNode; onPress?: () => void }) => (
    <button onClick={onPress}>{children}</button>
  ),
  Input: ({ value, onChangeText, label, testID }: {
    value: string; onChangeText?: (t: string) => void; label?: string; testID?: string
  }) => {
    const { TextInput } = require('react-native')
    return (
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChangeText}
        testID={testID}
      />
    )
  },
  Tag: ({ children, active, onPress }: {
    children: React.ReactNode; active?: boolean; onPress?: () => void
  }) => (
    <span data-active={active} onClick={onPress}>{children}</span>
  ),
  Textarea: ({ value, onChangeText }: { value: string; onChangeText?: (t: string) => void }) => (
    <textarea value={value} onChange={(e) => onChangeText?.(e.target.value)} />
  ),
  VerdictPicker: ({ value, onChange }: {
    value: string | null; onChange: (v: string) => void
  }) => (
    <div data-testid="verdict-picker" data-value={value}>
      {(['yum', 'meh', 'nah'] as const).map((v) => (
        <button key={v} data-verdict={v} onClick={() => onChange(v)}>{v}</button>
      ))}
    </div>
  ),
  VerdictStamp: ({ verdict }: { verdict: string }) => <span data-verdict={verdict} />,
}))

jest.mock('../PhotoPreview', () => ({
  PhotoPreview: () => null,
}))

// ---- helpers --------------------------------------------------------------

let currentRenderer: TestRenderer.ReactTestRenderer | null = null

function renderModal() {
  const onClose = jest.fn()
  const onSaved = jest.fn()
  let renderer!: TestRenderer.ReactTestRenderer
  act(() => {
    renderer = TestRenderer.create(<AddModal onClose={onClose} onSaved={onSaved} />)
  })
  currentRenderer = renderer
  return { renderer, onSaved }
}

function findSaveButton(renderer: TestRenderer.ReactTestRenderer) {
  return renderer.root.findAll(
    (n) =>
      (String(n.type) === 'button' || String(n.type) === 'Button') &&
      n.props.children === 'Save',
  )
}

/** Fill name + a verdict so the tasted-mode form is ready to save. */
function fillReady(renderer: TestRenderer.ReactTestRenderer) {
  const nameInput = renderer.root.findAll(
    (n) => n.props['accessibilityLabel'] === 'What?',
  )
  act(() => { nameInput[0].props.onChangeText('Cortado') })
  const yumBtn = renderer.root.findAll((n) => n.props['data-verdict'] === 'yum')
  act(() => { yumBtn[0].props.onClick() })
}

// ---- tests ----------------------------------------------------------------

describe('AddModal — active taster attribution', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockCreateTaste.mockResolvedValue({ id: 'new-id' })
    mockUseActiveTaster.mockReturnValue(null)
  })

  afterEach(() => {
    act(() => { currentRenderer?.unmount() })
    currentRenderer = null
  })

  it('includes the active non-self taster id in the createTaste payload', async () => {
    mockUseActiveTaster.mockReturnValue('ts_partner')
    const { renderer } = renderModal()
    fillReady(renderer)

    const saveButtons = findSaveButton(renderer)
    await act(async () => { saveButtons[0].props.onClick() })

    expect(mockCreateTaste).toHaveBeenCalledTimes(1)
    const [input] = mockCreateTaste.mock.calls[0]
    expect(input.tasterId).toBe('ts_partner')
  })

  it('sends no tasterId when the active taster is self (null) — server applies the self default', async () => {
    mockUseActiveTaster.mockReturnValue(null)
    const { renderer } = renderModal()
    fillReady(renderer)

    const saveButtons = findSaveButton(renderer)
    await act(async () => { saveButtons[0].props.onClick() })

    expect(mockCreateTaste).toHaveBeenCalledTimes(1)
    const [input] = mockCreateTaste.mock.calls[0]
    expect(input.tasterId).toBeUndefined()
  })
})
