/* ============================================================
   Regression test — AddModal sticky footer opaque background.

   User feedback: the Cancel + Save action footer was transparent,
   so it composited over scroll content beneath it when the keyboard
   rose (KeyboardStickyView translates the footer up with the keyboard).
   The "在哪里?" location row was visible through the footer.

   This test pins the fix: the footer View (testID="add-actions-footer")
   must declare a concrete backgroundColor so it occludes content below.
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

describe('AddModal footer background regression', () => {
  let currentRenderer: TestRenderer.ReactTestRenderer | null = null

  afterEach(() => {
    act(() => {
      currentRenderer?.unmount()
    })
    currentRenderer = null
  })

  it('footer View has a defined backgroundColor so it occludes content beneath it', () => {
    let renderer!: TestRenderer.ReactTestRenderer
    act(() => {
      renderer = TestRenderer.create(<AddModal onClose={() => {}} onSaved={() => {}} />)
    })
    currentRenderer = renderer

    const footer = renderer.root.findByProps({ testID: 'add-actions-footer' })
    expect(footer).toBeTruthy()

    // backgroundColor must be defined (not undefined/null/transparent).
    // Post-Tamagui migration: layout is in style object, not flat props.
    const st = footer.props.style as Record<string, unknown>
    const bg = st?.backgroundColor
    expect(bg).toBeDefined()
    expect(bg).not.toBeNull()
    expect(bg).not.toBe('')
    expect(bg).not.toBe('transparent')
  })
})
