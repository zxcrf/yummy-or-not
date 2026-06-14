/* ============================================================
   Regression test — AddModal sticky footer outside the scroll view.

   User feedback: the Cancel + Save action row was inside the scrollable
   body, so buttons scrolled away and were not always reachable.

   This test pins the fix: the footer (testID="add-actions-footer") must
   be a sibling of the ScrollView, NOT a descendant of it.
   ============================================================ */

import TestRenderer, { act } from 'react-test-renderer'
import { ScrollView } from 'react-native'
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

describe('AddModal footer placement regression', () => {
  let currentRenderer: TestRenderer.ReactTestRenderer | null = null

  afterEach(() => {
    act(() => {
      currentRenderer?.unmount()
    })
    currentRenderer = null
  })

  it('renders the actions footer outside the ScrollView (sticky, not scrollable)', () => {
    let renderer!: TestRenderer.ReactTestRenderer
    act(() => {
      renderer = TestRenderer.create(<AddModal onClose={() => {}} onSaved={() => {}} />)
    })
    currentRenderer = renderer

    // Footer must exist in the tree.
    const footer = renderer.root.findByProps({ testID: 'add-actions-footer' })
    expect(footer).toBeTruthy()

    // ScrollView must exist.
    const scrollView = renderer.root.findByType(ScrollView)
    expect(scrollView).toBeTruthy()

    // The footer must NOT be a descendant of the ScrollView.
    const footerInScroll = scrollView.findAll(
      (node) => node.props.testID === 'add-actions-footer',
    )
    expect(footerInScroll).toHaveLength(0)
  })
})
