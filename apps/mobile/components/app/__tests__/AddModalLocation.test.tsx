/* ============================================================
   Wiring tests — confirming a map pin in AddModal (create flow).

   The map picker is mocked to a prop-capturing stub (the native map can't mount
   here); we drive its onConfirm as the real picker would. The AddModal-side
   wiring is platform-independent and would otherwise only run on-device: a
   confirmed pin must reach the createTaste payload as lat/lng, and seed the
   place NICKNAME only when it is empty (never clobber a typed-in name).
   ============================================================ */

import TestRenderer, { act } from 'react-test-renderer'
import AddModal from '../AddModal'

const mockCreateTaste = jest.fn()
const mockPicker = { props: null as null | Record<string, unknown> }

jest.mock('../LocationPicker', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    mockPicker.props = props
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
        loc_pick_on_map: 'Pick on map', loc_pin_none: 'No pin', loc_pin_set: 'Pin set',
        loc_pin_clear: 'Clear', loc_pin_change: 'Change pin', loc_pin_label: 'Pinned location',
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
  return renderer.root.findAll(
    (n) => String(n.type) === 'Text' && n.props.children === text,
  )
}
function pressableByText(renderer: TestRenderer.ReactTestRenderer, text: string) {
  let node: TestRenderer.ReactTestInstance | null = textNodes(renderer, text)[0]
  while (node) {
    if (typeof node.props.onPress === 'function') return node
    node = node.parent
  }
  throw new Error(`No pressable ancestor for ${text}`)
}
function confirmPin(coords: { lat: number; lng: number }, place: string | null) {
  const onConfirm = mockPicker.props!.onConfirm as (c: typeof coords, p: string | null) => void
  return act(async () => { onConfirm(coords, place) })
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
    mockPicker.props = null
    mockCreateTaste.mockResolvedValue({ id: 'taste-new' })
  })
  afterEach(() => {
    act(() => { mounted.forEach((r) => r.unmount()) })
    mounted.length = 0
  })

  it('passes a null seed before any pin, then a confirmed pin reaches createTaste', async () => {
    const renderer = renderAddModal()
    // Before any pick the picker opens with no seed.
    expect(mockPicker.props!.initial).toBeNull()

    await confirmPin({ lat: 39.9087, lng: 116.3975 }, 'Beijing Cafe')
    await fillNameAndYum(renderer)
    await save(renderer)

    expect(mockCreateTaste).toHaveBeenCalledTimes(1)
    const [payload] = mockCreateTaste.mock.calls[0]
    expect(payload.lat).toBe(39.9087)
    expect(payload.lng).toBe(116.3975)
    // place was empty → seeded from the picked address.
    expect(payload.place).toBe('Beijing Cafe')
  })

  it('does not overwrite a place nickname the user already typed', async () => {
    const renderer = renderAddModal()

    const where = renderer.root.findByProps({ placeholder: 'Tiger Sugar · Hongdae' })
    await act(async () => { where.props.onChangeText('My Secret Spot') })

    await confirmPin({ lat: 39.9087, lng: 116.3975 }, 'Beijing Cafe')
    await fillNameAndYum(renderer)
    await save(renderer)

    const [payload] = mockCreateTaste.mock.calls[0]
    expect(payload.place).toBe('My Secret Spot')
    expect(payload.lat).toBe(39.9087)
  })

  it('reflects the confirmed pin coords in the row status', async () => {
    const renderer = renderAddModal()
    await confirmPin({ lat: 31.2304, lng: 121.4737 }, null)

    const status = renderer.root.findAllByProps({ testID: 'location-pin-status' })[0]
    expect(String(status.props.children)).toContain('31.23040')
  })
})
