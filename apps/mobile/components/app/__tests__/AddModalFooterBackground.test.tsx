/* ============================================================
   Regression test — AddModal header opaque background.

   History: the Cancel + Save action footer once needed a concrete
   backgroundColor so it occluded scroll content as it rode the keyboard.
   As of the unified EditActionHeader refactor (ADR 0001) that bottom
   footer is deleted; the actions live in the TOP header instead.

   This test pins the new reality: the old "add-actions-footer" is gone,
   and the top header (testID="add-modal-header") declares a concrete
   backgroundColor so the scroll body never shows through it.
   ============================================================ */

import TestRenderer, { act } from 'react-test-renderer'
import AddModal from '../AddModal'

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
  hasServicesEnabledAsync: jest.fn().mockResolvedValue(true),
  getLastKnownPositionAsync: jest.fn().mockResolvedValue(null),
  getCurrentPositionAsync: jest.fn(),
  reverseGeocodeAsync: jest.fn(),
}))

jest.mock('@yon/shared', () => ({
  TAG_CHOICES: ['Boba', 'Coffee'],
  createTaste: jest.fn(),
  createTag: jest.fn(),
  reverseGeocode: jest.fn(),
  searchTastes: jest.fn().mockReturnValue([]),
}))

jest.mock('@/app/(tabs)/_useTastes', () => ({
  invalidateTastes: jest.fn(async () => []),
  useRefreshableTastes: () => ({ items: [], refresh: jest.fn() }),
}))

jest.mock('@/app/(tabs)/_useActiveTaster', () => ({
  useActiveTaster: () => null,
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
  useAuth: () => ({ user: { warningsEnabled: true, locationEnabled: false } }),
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

describe('AddModal header background regression', () => {
  let currentRenderer: TestRenderer.ReactTestRenderer | null = null

  afterEach(() => {
    act(() => {
      currentRenderer?.unmount()
    })
    currentRenderer = null
  })

  it('the old sticky footer is gone (actions moved to the top header)', () => {
    let renderer!: TestRenderer.ReactTestRenderer
    act(() => {
      renderer = TestRenderer.create(<AddModal onClose={() => {}} onSaved={() => {}} />)
    })
    currentRenderer = renderer

    expect(
      renderer.root.findAllByProps({ testID: 'add-actions-footer' }),
    ).toHaveLength(0)
  })

  it('header View has a defined backgroundColor so the scroll body never shows through', () => {
    let renderer!: TestRenderer.ReactTestRenderer
    act(() => {
      renderer = TestRenderer.create(<AddModal onClose={() => {}} onSaved={() => {}} />)
    })
    currentRenderer = renderer

    // Both the composite EditActionHeader and its host View carry the testID;
    // pick the host View that actually carries the style object.
    const header = renderer.root.findAll(
      (n) => n.props.testID === 'add-modal-header' && n.props.style != null,
    )[0]
    expect(header).toBeTruthy()

    const st = header.props.style as Record<string, unknown>
    const bg = st?.backgroundColor
    expect(bg).toBeDefined()
    expect(bg).not.toBeNull()
    expect(bg).not.toBe('')
    expect(bg).not.toBe('transparent')
  })
})
