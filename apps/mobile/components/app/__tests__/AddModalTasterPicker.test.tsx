/* ============================================================
   Feature test — AddModal "记录给" attribution selector (issue #104).

   When a pro account owns family personas, the Add screen shows an explicit
   selector so the user chooses who a record is logged for (default = the active
   persona, self on the self tab). Pins:

   - selector renders (and 自己 is the default) when the account has family
     personas and the active persona is self;
   - tapping a family chip routes that tasterId into the createTaste payload;
   - tapping 自己 after a family chip clears the attribution (no tasterId);
   - no family personas → selector is absent (free / solo accounts unchanged).
   ============================================================ */

import TestRenderer, { act } from 'react-test-renderer'
import AddModal from '../AddModal'

jest.mock('react-native', () => {
  const actual = jest.requireActual('react-native')
  return new Proxy(actual, {
    get(target, prop, receiver) {
      if (prop === 'ScrollView') {
        return ({ children }: { children: React.ReactNode }) => <div>{children}</div>
      }
      return Reflect.get(target, prop, receiver)
    },
  })
})

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockCreateTaste = jest.fn<any, any[]>()
jest.mock('@yon/shared', () => ({
  TAG_CHOICES: ['Coffee', 'Boba'],
  createTaste: (a: unknown, b: unknown) => mockCreateTaste(a, b),
  createTag: jest.fn(),
  reverseGeocode: jest.fn(),
  searchTastes: () => [],
}))

jest.mock('@/app/(tabs)/_useTastes', () => ({
  invalidateTastes: jest.fn(),
  useRefreshableTastes: () => ({ items: [] }),
}))
jest.mock('@/app/(tabs)/_useTags', () => ({
  invalidateTagsCache: jest.fn(),
  useTags: () => ({ tags: [] }),
}))

let mockActiveTaster: string | null = null
jest.mock('@/app/(tabs)/_useActiveTaster', () => ({
  useActiveTaster: () => mockActiveTaster,
}))

let mockTasters: Array<{ id: string; isSelf: boolean; displayName: string }> = []
jest.mock('@/app/(tabs)/_useTasters', () => ({
  useTasters: () => ({ tasters: mockTasters, loading: false }),
}))

jest.mock('@/providers/I18nProvider', () => ({
  useI18n: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        f_what: 'What?',
        save_taste_web: 'Save',
        add_for: 'Log for',
        taster_self: 'You',
        v_yum: 'YUM', v_meh: 'MEH', v_nah: 'NAH',
      }
      return map[key] ?? key
    },
  }),
}))

let mockPlan = 'pro'
jest.mock('@/providers/AuthProvider', () => ({
  useAuth: () => ({ user: { plan: mockPlan, warningsEnabled: true, locationEnabled: false } }),
}))

jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }))
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

jest.mock('@/components/ds', () => ({
  Button: ({ children, onPress, disabled }: {
    children: React.ReactNode; onPress?: () => void; disabled?: boolean
  }) => <button onClick={onPress} disabled={disabled}>{children}</button>,
  Icon: ({ name }: { name: string }) => <span data-icon={name} />,
  IconButton: ({ children, onPress }: { children: React.ReactNode; onPress?: () => void }) => (
    <button onClick={onPress}>{children}</button>
  ),
  Input: ({ value, onChangeText, label }: {
    value: string; onChangeText?: (t: string) => void; label?: string
  }) => {
    const { TextInput } = require('react-native')
    return <TextInput accessibilityLabel={label} value={value} onChangeText={onChangeText} />
  },
  Tag: ({ children, active, onPress }: {
    children: React.ReactNode; active?: boolean; onPress?: () => void
  }) => <span data-active={active} onClick={onPress}>{children}</span>,
  Textarea: ({ value, onChangeText }: { value: string; onChangeText?: (t: string) => void }) => (
    <textarea value={value} onChange={(e) => onChangeText?.(e.target.value)} />
  ),
  VerdictPicker: ({ onChange }: { onChange: (v: string) => void }) => (
    <div>
      {(['yum', 'meh', 'nah'] as const).map((v) => (
        <button key={v} data-verdict={v} onClick={() => onChange(v)}>{v}</button>
      ))}
    </div>
  ),
  VerdictStamp: () => null,
}))

jest.mock('../PhotoPreview', () => ({ PhotoPreview: () => null }))

let currentRenderer: TestRenderer.ReactTestRenderer | null = null

function renderModal() {
  let renderer!: TestRenderer.ReactTestRenderer
  act(() => {
    renderer = TestRenderer.create(<AddModal onClose={jest.fn()} onSaved={jest.fn()} />)
  })
  currentRenderer = renderer
  return renderer
}

function fillReady(renderer: TestRenderer.ReactTestRenderer) {
  const nameInput = renderer.root.findAll((n) => n.props['accessibilityLabel'] === 'What?')
  act(() => { nameInput[0].props.onChangeText('Cortado') })
  const yumBtn = renderer.root.findAll((n) => n.props['data-verdict'] === 'yum')
  act(() => { yumBtn[0].props.onClick() })
}

/** Find a Tag chip (mock = span with data-active) by its label text. */
function chip(renderer: TestRenderer.ReactTestRenderer, label: string) {
  return renderer.root.find(
    (n) => String(n.type) === 'span' && n.props.children === label && 'data-active' in n.props,
  )
}

function save(renderer: TestRenderer.ReactTestRenderer) {
  const btn = renderer.root.findAll(
    (n) => String(n.type) === 'button' && n.props.children === 'Save',
  )[0]
  return act(async () => { btn.props.onClick() })
}

describe('AddModal — taster attribution selector', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockCreateTaste.mockResolvedValue({ id: 'new-id' })
    mockPlan = 'pro'
    mockActiveTaster = null
    mockTasters = [
      { id: 'ts_self', isSelf: true, displayName: 'You' },
      { id: 'ts_wife', isSelf: false, displayName: 'Wife' },
    ]
  })

  afterEach(() => {
    act(() => { currentRenderer?.unmount() })
    currentRenderer = null
  })

  it('renders the selector with 自己 selected by default on the self tab', () => {
    const renderer = renderModal()
    expect(renderer.root.findAllByProps({ testID: 'add-taster-picker' }).length).toBeGreaterThan(0)
    expect(chip(renderer, 'You').props['data-active']).toBe(true)
    expect(chip(renderer, 'Wife').props['data-active']).toBe(false)
  })

  it('logs for the chosen family persona when its chip is tapped', async () => {
    const renderer = renderModal()
    act(() => { chip(renderer, 'Wife').props.onClick() })
    fillReady(renderer)
    await save(renderer)

    expect(mockCreateTaste).toHaveBeenCalledTimes(1)
    expect(mockCreateTaste.mock.calls[0][0].tasterId).toBe('ts_wife')
  })

  it('tapping 自己 after a family chip clears the attribution (no tasterId)', async () => {
    const renderer = renderModal()
    act(() => { chip(renderer, 'Wife').props.onClick() })
    act(() => { chip(renderer, 'You').props.onClick() })
    fillReady(renderer)
    await save(renderer)

    expect(mockCreateTaste).toHaveBeenCalledTimes(1)
    expect(mockCreateTaste.mock.calls[0][0].tasterId).toBeUndefined()
  })

  it('hides the selector when the account owns no family personas', () => {
    mockTasters = [{ id: 'ts_self', isSelf: true, displayName: 'You' }]
    const renderer = renderModal()
    expect(renderer.root.findAllByProps({ testID: 'add-taster-picker' })).toHaveLength(0)
  })

  it('hides the selector for a free account even if personas are present', () => {
    mockPlan = 'free'
    const renderer = renderModal()
    expect(renderer.root.findAllByProps({ testID: 'add-taster-picker' })).toHaveLength(0)
  })

  // Regression: when the picker is hidden the user cannot see or change who a
  // record is attributed to, so Save must never carry a stale/invisible taster
  // id (even if the active persona somehow points at a family member).
  it('does not submit a tasterId when the picker is hidden (no family personas)', async () => {
    mockTasters = [{ id: 'ts_self', isSelf: true, displayName: 'You' }]
    mockActiveTaster = 'ts_wife' // stale/dangling active id, picker not shown
    const renderer = renderModal()
    expect(renderer.root.findAllByProps({ testID: 'add-taster-picker' })).toHaveLength(0)
    fillReady(renderer)
    await save(renderer)

    expect(mockCreateTaste).toHaveBeenCalledTimes(1)
    expect(mockCreateTaste.mock.calls[0][0].tasterId).toBeUndefined()
  })
})
