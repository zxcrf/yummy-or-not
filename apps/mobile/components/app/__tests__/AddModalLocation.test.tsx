/* ============================================================
   Wiring tests — confirming a map pin in AddModal (create flow).

   AddModal no longer renders the picker; it calls the app-root picker via
   useLocationPicker().open(initial, onConfirm). These tests mock the opener + the
   pin row to drive that flow without the native map, and assert the AddModal-side
   wiring: a confirmed pin reaches the createTaste payload as lat/lng, and seeds
   the place NICKNAME only when it is empty (never clobbers a typed-in name).
   ============================================================ */

import TestRenderer, { act } from 'react-test-renderer'
import AddModal from '../AddModal'

const mockCreateTaste = jest.fn()

// Capture the (initial, onConfirm) the screen hands to the app-root picker.
const mockPickerOpen = {
  initial: undefined as unknown,
  onConfirm: null as null | ((c: { lat: number; lng: number }, p: string | null) => void),
}
jest.mock('@/providers/LocationPickerProvider', () => ({
  useLocationPicker: () => ({
    open: (initial: unknown, onConfirm: (c: { lat: number; lng: number }, p: string | null) => void) => {
      mockPickerOpen.initial = initial
      mockPickerOpen.onConfirm = onConfirm
    },
  }),
}))

// Capture the pin row's props (the Android-only "pick on map" button doesn't
// render under the jest platform, so we fire onOpenPicker / onClear directly).
const mockPinRow = { props: null as null | Record<string, unknown> }
jest.mock('../LocationPinRow', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    mockPinRow.props = props
    return null
  },
}))

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}))
jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
}))
jest.mock('expo-image-manipulator', () => ({
  manipulateAsync: jest.fn(),
  SaveFormat: { JPEG: 'jpeg' },
}))
jest.mock('expo-location', () => ({
  Accuracy: { Balanced: 'balanced', High: 'high' },
  requestForegroundPermissionsAsync: jest.fn(),
  hasServicesEnabledAsync: jest.fn(),
  getLastKnownPositionAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
  reverseGeocodeAsync: jest.fn(),
}))
jest.mock('@yon/shared', () => ({
  TAG_CHOICES: ['Boba', 'Coffee'],
  createTaste: (...args: unknown[]) => mockCreateTaste(...args),
  createTag: jest.fn(),
  reverseGeocode: jest.fn().mockResolvedValue({ place: null }),
  searchTastes: jest.fn().mockReturnValue([]),
}))
jest.mock('@/app/(tabs)/_useTastes', () => ({
  invalidateTastes: jest.fn(async () => []),
  useRefreshableTastes: () => ({ items: [], refresh: jest.fn() }),
}))
jest.mock('@/app/(tabs)/_useTasters', () => ({ useTasters: () => ({ tasters: [], loading: false }) }))
jest.mock('@/app/(tabs)/_useTags', () => ({
  useTags: () => ({ tags: [], loading: false }),
  invalidateTagsCache: jest.fn(),
  clearTagsCache: jest.fn(),
}))
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }))
jest.mock('@/providers/AuthProvider', () => ({
  useAuth: () => ({ user: { warningsEnabled: true, locationEnabled: true } }),
}))
jest.mock('@/providers/I18nProvider', () => ({
  useI18n: () => ({
    t: (key: string) =>
      ({
        add_photo: 'Add a photo', add_tag: 'Add tag', cancel: 'Cancel', f_price: 'Price',
        f_what: 'What did you have?', f_where: 'Where?', how_was_it: 'How was it?',
        log_taste: 'Log a taste', save_taste_web: 'Save taste', tags: 'Tags',
        v_meh: 'MEH', v_nah: 'NAH', v_yum: 'YUM', your_take: 'Your take',
      })[key] ?? key,
  }),
}))

const mounted: TestRenderer.ReactTestRenderer[] = []

function renderAddModal() {
  let renderer!: TestRenderer.ReactTestRenderer
  act(() => {
    renderer = TestRenderer.create(<AddModal onClose={() => {}} onSaved={() => {}} />)
  })
  mounted.push(renderer)
  return renderer
}
function textNodes(renderer: TestRenderer.ReactTestRenderer, text: string) {
  return renderer.root.findAll((n) => String(n.type) === 'Text' && n.props.children === text)
}
function pressableByText(renderer: TestRenderer.ReactTestRenderer, text: string) {
  let node: TestRenderer.ReactTestInstance | null = textNodes(renderer, text)[0]
  while (node) {
    if (typeof node.props.onPress === 'function') return node
    node = node.parent
  }
  throw new Error(`No pressable ancestor for ${text}`)
}
function fireOpenPicker() {
  return act(async () => { (mockPinRow.props!.onOpenPicker as () => void)() })
}
function confirmPin(coords: { lat: number; lng: number }, place: string | null) {
  return act(async () => { mockPickerOpen.onConfirm!(coords, place) })
}
async function fillNameAndYum(renderer: TestRenderer.ReactTestRenderer) {
  const name = renderer.root.findByProps({ placeholder: 'Brown sugar boba' })
  await act(async () => {
    name.props.onChangeText('Brown sugar boba')
    pressableByText(renderer, 'YUM').props.onPress()
  })
}
async function save(renderer: TestRenderer.ReactTestRenderer) {
  const btn = renderer.root.findAllByProps({ testID: 'add-save-btn' })[0]
  await act(async () => { await btn.props.onPress() })
}

describe('AddModal — map pin confirm wiring', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockPinRow.props = null
    mockPickerOpen.initial = undefined
    mockPickerOpen.onConfirm = null
    mockCreateTaste.mockResolvedValue({ id: 'taste-new' })
  })
  afterEach(() => {
    act(() => { mounted.forEach((r) => r.unmount()) })
    mounted.length = 0
  })

  it('passes a null seed before any pin, then a confirmed pin reaches createTaste', async () => {
    const renderer = renderAddModal()
    await fireOpenPicker()
    expect(mockPickerOpen.initial).toBeNull()

    await confirmPin({ lat: 39.9087, lng: 116.3975 }, 'Beijing Cafe')
    await fillNameAndYum(renderer)
    await save(renderer)

    expect(mockCreateTaste).toHaveBeenCalledTimes(1)
    const [payload] = mockCreateTaste.mock.calls[0]
    expect(payload.lat).toBe(39.9087)
    expect(payload.lng).toBe(116.3975)
    expect(payload.place).toBe('Beijing Cafe')
  })

  it('does not overwrite a place nickname the user already typed', async () => {
    const renderer = renderAddModal()
    const where = renderer.root.findByProps({ placeholder: 'Tiger Sugar · Hongdae' })
    await act(async () => { where.props.onChangeText('My Secret Spot') })

    await fireOpenPicker()
    await confirmPin({ lat: 39.9087, lng: 116.3975 }, 'Beijing Cafe')
    await fillNameAndYum(renderer)
    await save(renderer)

    const [payload] = mockCreateTaste.mock.calls[0]
    expect(payload.place).toBe('My Secret Spot')
    expect(payload.lat).toBe(39.9087)
  })

  it('passes the current pin as the seed once one is set', async () => {
    const renderer = renderAddModal()
    await fireOpenPicker()
    await confirmPin({ lat: 31.2304, lng: 121.4737 }, null)

    // Reopening now seeds the picker with the pin just chosen.
    await fireOpenPicker()
    expect(mockPickerOpen.initial).toEqual({ lat: 31.2304, lng: 121.4737 })
  })
})
