/* ============================================================
   Regression test — locateMe accuracy + services-enabled guard.

   Bug 1: locateMe used Accuracy.Balanced which does NOT power on GPS
   for a cold fix — after reinstall (no warm fix) it never acquired
   a position and hit the 15s timeout → 定位失败.
   Fix: use Accuracy.High (forces active GPS acquisition).

   Bug 2: when location services are disabled at the OS level, locateMe
   silently waited 15s then failed. Fix: hasServicesEnabledAsync() check
   at the top of the happy path — if false, fail immediately (no wait).
   ============================================================ */

import TestRenderer, { act } from 'react-test-renderer'
import AddModal from '../AddModal'

const mockRequestForegroundPermissionsAsync = jest.fn()
const mockHasServicesEnabledAsync = jest.fn()
const mockGetLastKnownPositionAsync = jest.fn()
const mockGetCurrentPositionAsync = jest.fn()
const mockReverseGeocodeAsync = jest.fn()
const mockServerReverseGeocode = jest.fn()

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
  hasServicesEnabledAsync: (...args: unknown[]) =>
    mockHasServicesEnabledAsync(...args),
  getLastKnownPositionAsync: (...args: unknown[]) =>
    mockGetLastKnownPositionAsync(...args),
  getCurrentPositionAsync: (...args: unknown[]) =>
    mockGetCurrentPositionAsync(...args),
  reverseGeocodeAsync: (...args: unknown[]) => mockReverseGeocodeAsync(...args),
}))

jest.mock('@yon/shared', () => ({
  TAG_CHOICES: ['Boba', 'Coffee'],
  createTaste: jest.fn(),
  createTag: jest.fn(),
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
  useAuth: () => ({ user: { warningsEnabled: true, locationEnabled: true } }),
}))

jest.mock('@/providers/I18nProvider', () => ({
  useI18n: () => ({
    t: (key: string) =>
      ({
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
      })[key] ?? key,
  }),
}))

function renderAddModal(): TestRenderer.ReactTestRenderer {
  let renderer!: TestRenderer.ReactTestRenderer
  act(() => {
    renderer = TestRenderer.create(<AddModal onClose={() => {}} onSaved={() => {}} />)
  })
  return renderer
}

describe('locateMe accuracy + services guard regression', () => {
  let currentRenderer: TestRenderer.ReactTestRenderer | null = null

  beforeEach(() => {
    jest.useFakeTimers()
    jest.clearAllMocks()
    mockRequestForegroundPermissionsAsync.mockResolvedValue({ granted: true })
    mockHasServicesEnabledAsync.mockResolvedValue(true)
    mockGetLastKnownPositionAsync.mockResolvedValue(null)
    mockGetCurrentPositionAsync.mockResolvedValue({
      coords: { latitude: 31.23, longitude: 121.47 },
    })
    mockReverseGeocodeAsync.mockResolvedValue([
      { name: 'Some Place', city: 'Shanghai', region: 'SH' },
    ])
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

  it('calls getCurrentPositionAsync with Accuracy.High (not Balanced)', async () => {
    const renderer = renderAddModal()
    currentRenderer = renderer

    await act(async () => {
      await renderer.root.findByProps({ testID: 'locate-button' }).props.onPress()
    })

    // Must be called with High, not Balanced — this is the core regression fix.
    expect(mockGetCurrentPositionAsync).toHaveBeenCalledWith(
      expect.objectContaining({ accuracy: 'high' }),
    )
    expect(mockGetCurrentPositionAsync).not.toHaveBeenCalledWith(
      expect.objectContaining({ accuracy: 'balanced' }),
    )
  })

  it('fails immediately (no 15s wait) when location services are disabled', async () => {
    mockHasServicesEnabledAsync.mockResolvedValue(false)
    const renderer = renderAddModal()
    currentRenderer = renderer

    await act(async () => {
      await renderer.root.findByProps({ testID: 'locate-button' }).props.onPress()
    })

    // getCurrentPositionAsync must NOT have been called at all — we bailed early.
    expect(mockGetCurrentPositionAsync).not.toHaveBeenCalled()

    // Failure hint must be visible immediately (no timer advance needed).
    expect(
      renderer.root.findAllByProps({ testID: 'loc-failed-hint' }).length,
    ).toBeGreaterThanOrEqual(1)
  })
})
