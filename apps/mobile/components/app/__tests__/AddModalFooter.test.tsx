/* ============================================================
   Regression test — AddModal action placement.

   History: the Cancel + Save row was once a sticky footer below the
   scroll view (testID="add-actions-footer"). As of the unified
   EditActionHeader refactor (ADR 0001) the save/cancel actions live in
   the TOP header instead, and the bottom sticky footer is deleted.

   This test now pins that new reality: there is NO "add-actions-footer"
   in the tree, and the cancel/save controls are reachable via the
   shared header (testID="add-modal-header" / "add-save-btn").
   ============================================================ */

import TestRenderer, { act } from 'react-test-renderer'
import AddModal from '../AddModal'

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
}))

jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
}))

jest.mock('expo-image-manipulator', () => ({
  manipulateAsync: jest.fn(),
  SaveFormat: { JPEG: 'jpeg' },
}))

jest.mock('@yon/shared', () => ({
  TAG_CHOICES: ['Boba', 'Coffee'],
  createTaste: jest.fn(),
  createTag: jest.fn(),
  searchTastes: jest.fn().mockReturnValue([]),
}))

jest.mock('@/app/(tabs)/_useTastes', () => ({
  invalidateTastes: jest.fn(async () => []),
  useRefreshableTastes: () => ({ items: [], refresh: jest.fn() }),
}))

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn() }),
}))

jest.mock('@/providers/AuthProvider', () => ({
  useAuth: () => ({ user: { warningsEnabled: true } }),
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
        photo_permission_denied: 'Photo access is needed to choose a picture.',
        save_taste_web: 'Save taste',
        tag_placeholder: 'New tag',
        tags: 'Tags',
        v_meh: 'MEH',
        v_nah: 'NAH',
        v_yum: 'YUM',
        your_take: 'Your take',
      })[key] ?? key,
  }),
}))

jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
  reverseGeocodeAsync: jest.fn(),
}))

describe('AddModal action placement (header, no sticky footer)', () => {
  let currentRenderer: TestRenderer.ReactTestRenderer | null = null

  afterEach(() => {
    act(() => {
      currentRenderer?.unmount()
    })
    currentRenderer = null
  })

  it('no longer renders the old sticky actions footer', () => {
    let renderer!: TestRenderer.ReactTestRenderer
    act(() => {
      renderer = TestRenderer.create(<AddModal onClose={() => {}} onSaved={() => {}} />)
    })
    currentRenderer = renderer

    // The bottom sticky footer is deleted — actions moved to the top header.
    expect(
      renderer.root.findAllByProps({ testID: 'add-actions-footer' }),
    ).toHaveLength(0)
  })

  it('places save/cancel in the unified top header', () => {
    let renderer!: TestRenderer.ReactTestRenderer
    act(() => {
      renderer = TestRenderer.create(<AddModal onClose={() => {}} onSaved={() => {}} />)
    })
    currentRenderer = renderer

    expect(renderer.root.findByProps({ testID: 'add-modal-header' })).toBeTruthy()
    expect(renderer.root.findByProps({ testID: 'add-save-btn' })).toBeTruthy()
  })
})
