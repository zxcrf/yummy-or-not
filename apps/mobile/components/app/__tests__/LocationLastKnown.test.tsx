/* ============================================================
   Regression test — "使用当前位置" 定位失败 on fresh Android builds.

   User feedback (Image 4): tapping 使用当前位置 showed "定位失败，可手动填写"
   even though it worked on earlier builds. Root cause: locateMe relied
   solely on getCurrentPositionAsync, which on a cold GPS / fresh build can
   stall past the timeout — and any throw flipped the 定位失败 banner.

   The fix tries Location.getLastKnownPositionAsync first as a fast cached
   source and only shows 定位失败 when EVERY position source comes up empty.

   These tests pin that behavior:
   - getCurrentPositionAsync rejects/times out BUT getLastKnownPositionAsync
     returns coords → 定位失败 NOT shown, coords are recorded and saved.
   - every position source fails → 定位失败 IS shown.

   Against the old code (no last-known fallback) the first test fails:
   a rejected getCurrentPositionAsync always set locFailed.
   ============================================================ */

import TestRenderer, { act } from 'react-test-renderer'
import AddModal from '../AddModal'

const mockCreateTaste = jest.fn()
const mockCreateTag = jest.fn()
const mockRequestForegroundPermissionsAsync = jest.fn()
const mockHasServicesEnabledAsync = jest.fn()
const mockGetCurrentPositionAsync = jest.fn()
const mockGetLastKnownPositionAsync = jest.fn()
const mockReverseGeocodeAsync = jest.fn()
const mockServerReverseGeocode = jest.fn()

let currentRenderer: TestRenderer.ReactTestRenderer | null = null

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
  requestForegroundPermissionsAsync: (...args: unknown[]) =>
    mockRequestForegroundPermissionsAsync(...args),
  hasServicesEnabledAsync: (...args: unknown[]) => mockHasServicesEnabledAsync(...args),
  getCurrentPositionAsync: (...args: unknown[]) => mockGetCurrentPositionAsync(...args),
  getLastKnownPositionAsync: (...args: unknown[]) => mockGetLastKnownPositionAsync(...args),
  reverseGeocodeAsync: (...args: unknown[]) => mockReverseGeocodeAsync(...args),
}))

jest.mock('@yon/shared', () => ({
  TAG_CHOICES: ['Boba', 'Coffee'],
  createTaste: (...args: unknown[]) => mockCreateTaste(...args),
  createTag: (...args: unknown[]) => mockCreateTag(...args),
  reverseGeocode: (...args: unknown[]) => mockServerReverseGeocode(...args),
  searchTastes: jest.fn().mockReturnValue([]),
}))

jest.mock('@/app/(tabs)/_useTastes', () => ({
  invalidateTastes: jest.fn(async () => []),
  useRefreshableTastes: () => ({ items: [], refresh: jest.fn() }),
}))

jest.mock('@/app/(tabs)/_useTasters', () => ({
  useTasters: () => ({ tasters: [], loading: false }),
}))

jest.mock('@/app/(tabs)/_useTags', () => ({
  useTags: () => ({ tags: [], loading: false }),
  invalidateTagsCache: jest.fn(),
  clearTagsCache: jest.fn(),
}))

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn() }),
}))

jest.mock('@/providers/AuthProvider', () => ({
  useAuth: () => ({
    user: { warningsEnabled: true, locationEnabled: true },
  }),
}))

jest.mock('@/providers/I18nProvider', () => ({
  useI18n: () => ({
    t: (key: string) => ({
      add_photo: 'Add a photo',
      add_tag: 'Add tag',
      cancel: 'Cancel',
      f_price: 'Price',
      f_what: 'What did you have?',
      f_where: 'Where?',
      how_was_it: 'How was it?',
      log_taste: 'Log a taste',
      loc_locating: 'Locating…',
      loc_use_location: 'Use current location',
      loc_recorded: 'Location recorded',
      loc_failed: "Couldn't get location",
      photo_permission_denied: 'Photo access is needed to choose a picture.',
      save_taste_web: 'Save taste',
      tags: 'Tags',
      v_meh: 'MEH',
      v_nah: 'NAH',
      v_yum: 'YUM',
      your_take: 'Your take',
    }[key] ?? key),
  }),
}))

function renderAddModal(): TestRenderer.ReactTestRenderer {
  let renderer!: TestRenderer.ReactTestRenderer
  act(() => {
    renderer = TestRenderer.create(<AddModal onClose={() => {}} onSaved={() => {}} />)
  })
  currentRenderer = renderer
  return renderer
}

function pressableByText(
  renderer: TestRenderer.ReactTestRenderer,
  text: string,
): TestRenderer.ReactTestInstance {
  const matches = renderer.root.findAll(
    (node) =>
      typeof node.props.children === 'string' && node.props.children === text,
  )
  let node: TestRenderer.ReactTestInstance | null = matches[0] ?? null
  while (node) {
    if (typeof node.props.onPress === 'function') return node
    node = node.parent
  }
  throw new Error(`No pressable ancestor found for ${text}`)
}

describe('AddModal locate — last-known-position fallback', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    jest.clearAllMocks()
    mockCreateTaste.mockResolvedValue({ id: 'taste-1' })
    mockRequestForegroundPermissionsAsync.mockResolvedValue({ granted: true })
    mockHasServicesEnabledAsync.mockResolvedValue(true)
    mockReverseGeocodeAsync.mockResolvedValue([])
    mockServerReverseGeocode.mockResolvedValue({ place: null })
  })

  afterEach(() => {
    act(() => {
      currentRenderer?.unmount()
    })
    currentRenderer = null
    jest.runOnlyPendingTimers()
    jest.clearAllTimers()
    jest.useRealTimers()
  })

  it('uses last-known coords (no 定位失败) when getCurrentPositionAsync rejects', async () => {
    // Fresh GPS: the live fix fails, but the OS has a recent cached position.
    mockGetLastKnownPositionAsync.mockResolvedValue({
      coords: { latitude: 35.6812, longitude: 139.7671 },
    })
    mockGetCurrentPositionAsync.mockRejectedValue(new Error('position_unavailable'))
    const renderer = renderAddModal()

    const nameField = renderer.root.findByProps({ placeholder: 'Brown sugar boba' })
    const yumOption = pressableByText(renderer, 'YUM')
    const saveButton = pressableByText(renderer, 'Save taste')

    await act(async () => {
      await renderer.root.findByProps({ testID: 'locate-button' }).props.onPress()
    })

    // The regression: old code showed 定位失败 the moment getCurrentPositionAsync
    // threw. With the last-known fallback it must NOT appear, and the recorded
    // marker (coords captured) must.
    expect(renderer.root.findAllByProps({ testID: 'loc-failed-hint' })).toHaveLength(0)
    expect(
      renderer.root.findAllByProps({ testID: 'loc-recorded-marker' }).length,
    ).toBeGreaterThanOrEqual(1)

    act(() => {
      nameField.props.onChangeText('Brown sugar boba')
      yumOption.props.onPress()
    })
    act(() => {
      jest.advanceTimersByTime(500)
    })
    await act(async () => {
      await saveButton.props.onPress()
    })

    // The cached coords are the ones persisted.
    expect(mockCreateTaste).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Brown sugar boba',
        verdict: 'yum',
        lat: 35.6812,
        lng: 139.7671,
      }),
      null,
    )
  })

  it('prefers a fresh fix over last-known when getCurrentPositionAsync resolves', async () => {
    mockGetLastKnownPositionAsync.mockResolvedValue({
      coords: { latitude: 1, longitude: 2 },
    })
    mockGetCurrentPositionAsync.mockResolvedValue({
      coords: { latitude: 35.6812, longitude: 139.7671 },
    })
    const renderer = renderAddModal()

    const nameField = renderer.root.findByProps({ placeholder: 'Brown sugar boba' })
    const yumOption = pressableByText(renderer, 'YUM')
    const saveButton = pressableByText(renderer, 'Save taste')

    await act(async () => {
      await renderer.root.findByProps({ testID: 'locate-button' }).props.onPress()
    })

    expect(renderer.root.findAllByProps({ testID: 'loc-failed-hint' })).toHaveLength(0)

    act(() => {
      nameField.props.onChangeText('Brown sugar boba')
      yumOption.props.onPress()
    })
    act(() => {
      jest.advanceTimersByTime(500)
    })
    await act(async () => {
      await saveButton.props.onPress()
    })

    expect(mockCreateTaste).toHaveBeenCalledWith(
      expect.objectContaining({ lat: 35.6812, lng: 139.7671 }),
      null,
    )
  })

  it('shows 定位失败 only when every position source fails', async () => {
    mockGetLastKnownPositionAsync.mockResolvedValue(null)
    mockGetCurrentPositionAsync.mockRejectedValue(new Error('position_unavailable'))
    const renderer = renderAddModal()

    await act(async () => {
      await renderer.root.findByProps({ testID: 'locate-button' }).props.onPress()
    })

    expect(
      renderer.root.findAllByProps({ testID: 'loc-failed-hint' }).length,
    ).toBeGreaterThanOrEqual(1)
    expect(renderer.root.findAllByProps({ testID: 'loc-recorded-marker' })).toHaveLength(0)
  })

  it('does not 定位失败 when coords succeed but reverse-geocode fails (coords still usable)', async () => {
    mockGetLastKnownPositionAsync.mockResolvedValue(null)
    mockGetCurrentPositionAsync.mockResolvedValue({
      coords: { latitude: 35.6812, longitude: 139.7671 },
    })
    // Both geocode sources blow up — must NOT surface 定位失败.
    mockReverseGeocodeAsync.mockRejectedValue(new Error('geocode_down'))
    mockServerReverseGeocode.mockRejectedValue(new Error('amap_down'))
    const renderer = renderAddModal()

    await act(async () => {
      await renderer.root.findByProps({ testID: 'locate-button' }).props.onPress()
    })

    expect(renderer.root.findAllByProps({ testID: 'loc-failed-hint' })).toHaveLength(0)
    expect(
      renderer.root.findAllByProps({ testID: 'loc-recorded-marker' }).length,
    ).toBeGreaterThanOrEqual(1)
  })
})
