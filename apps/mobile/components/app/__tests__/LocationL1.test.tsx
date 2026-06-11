import TestRenderer, { act } from 'react-test-renderer'
import AddModal from '../AddModal'

const mockCreateTaste = jest.fn()
const mockCreateTag = jest.fn()
const mockRequestForegroundPermissionsAsync = jest.fn()
const mockGetCurrentPositionAsync = jest.fn()
const mockReverseGeocodeAsync = jest.fn()
const mockServerReverseGeocode = jest.fn()
const mockRouterPush = jest.fn()

let mockLocationEnabled = false
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
  Accuracy: { Balanced: 'balanced' },
  requestForegroundPermissionsAsync: (...args: unknown[]) =>
    mockRequestForegroundPermissionsAsync(...args),
  getCurrentPositionAsync: (...args: unknown[]) => mockGetCurrentPositionAsync(...args),
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

jest.mock('@/app/(tabs)/_useTags', () => ({
  useTags: () => ({ tags: [], loading: false }),
  invalidateTagsCache: jest.fn(),
  clearTagsCache: jest.fn(),
}))

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockRouterPush }),
}))

jest.mock('@/providers/AuthProvider', () => ({
  useAuth: () => ({
    user: { warningsEnabled: true, locationEnabled: mockLocationEnabled },
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
    renderer = TestRenderer.create(
      <AddModal onClose={() => {}} onSaved={() => {}} />,
    )
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
      typeof node.props.children === 'string' &&
      node.props.children === text,
  )
  let node: TestRenderer.ReactTestInstance | null = matches[0] ?? null
  while (node) {
    if (typeof node.props.onPress === 'function') return node
    node = node.parent
  }
  throw new Error(`No pressable ancestor found for ${text}`)
}

describe('Location L1', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    jest.clearAllMocks()
    mockLocationEnabled = false
    mockCreateTaste.mockResolvedValue({ id: 'taste-1' })
    mockRequestForegroundPermissionsAsync.mockResolvedValue({ granted: true })
    mockGetCurrentPositionAsync.mockResolvedValue({
      coords: { latitude: -31.9523, longitude: 115.8613 },
    })
    mockReverseGeocodeAsync.mockResolvedValue([
      { name: 'Tiger Sugar', city: 'Perth', region: 'WA' },
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

  it('does not render the locate button when locationEnabled=false', () => {
    const renderer = renderAddModal()
    expect(renderer.root.findAllByProps({ testID: 'locate-button' })).toHaveLength(0)
  })

  it('renders the button, stores coords, and fills place on success', async () => {
    mockLocationEnabled = true
    const renderer = renderAddModal()

    const locate = renderer.root.findByProps({ testID: 'locate-button' })
    const nameField = renderer.root.findByProps({ placeholder: 'Brown sugar boba' })
    const placeField = renderer.root.findByProps({ placeholder: 'Tiger Sugar · Hongdae' })
    const yumOption = pressableByText(renderer, 'YUM')
    const saveButton = pressableByText(renderer, 'Save taste')

    await act(async () => {
      await locate.props.onPress()
    })

    expect(placeField.props.value).toBe('Tiger Sugar · Perth, WA')
    expect(mockGetCurrentPositionAsync).toHaveBeenCalledWith({ accuracy: 'balanced' })
    expect(mockReverseGeocodeAsync).toHaveBeenCalledWith({
      latitude: -31.9523,
      longitude: 115.8613,
    })

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
      expect.objectContaining({
        name: 'Brown sugar boba',
        place: 'Tiger Sugar · Perth, WA',
        verdict: 'yum',
        lat: -31.9523,
        lng: 115.8613,
      }),
      null,
    )
  })

  it('permission denied path degrades silently and save still works without lat/lng', async () => {
    mockLocationEnabled = true
    mockRequestForegroundPermissionsAsync.mockRejectedValue(new Error('denied'))
    const renderer = renderAddModal()

    const locate = renderer.root.findByProps({ testID: 'locate-button' })
    const nameField = renderer.root.findByProps({ placeholder: 'Brown sugar boba' })
    const yumOption = pressableByText(renderer, 'YUM')
    const saveButton = pressableByText(renderer, 'Save taste')

    await act(async () => {
      await locate.props.onPress()
    })

    expect(renderer.root.findAllByProps({ testID: 'locate-button' })).toHaveLength(0)
    expect(mockGetCurrentPositionAsync).not.toHaveBeenCalled()

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
      expect.objectContaining({
        name: 'Brown sugar boba',
        verdict: 'yum',
        lat: null,
        lng: null,
      }),
      null,
    )
  })

  it('shows "recorded" marker once coords are captured even when place stays empty', async () => {
    mockLocationEnabled = true
    mockReverseGeocodeAsync.mockResolvedValue([])
    mockServerReverseGeocode.mockResolvedValue({ place: null })
    const renderer = renderAddModal()

    await act(async () => {
      await renderer.root.findByProps({ testID: 'locate-button' }).props.onPress()
    })

    // Recorded marker should appear (findAllByProps may return the element + fiber wrapper)
    expect(renderer.root.findAllByProps({ testID: 'loc-recorded-marker' }).length).toBeGreaterThanOrEqual(1)
    // Place field should still be empty (user can edit manually)
    const placeField = renderer.root.findByProps({ placeholder: 'Tiger Sugar · Hongdae' })
    expect(placeField.props.value).toBe('')
  })

  it('uses server fallback when native reverseGeocodeAsync returns empty', async () => {
    mockLocationEnabled = true
    mockReverseGeocodeAsync.mockResolvedValue([])
    mockServerReverseGeocode.mockResolvedValue({ place: 'Server Place Name' })
    const renderer = renderAddModal()

    await act(async () => {
      await renderer.root.findByProps({ testID: 'locate-button' }).props.onPress()
    })

    const placeField = renderer.root.findByProps({ placeholder: 'Tiger Sugar · Hongdae' })
    expect(placeField.props.value).toBe('Server Place Name')
    expect(mockServerReverseGeocode).toHaveBeenCalledWith(-31.9523, 115.8613)
  })

  it('does not call server fallback when native geocode succeeds', async () => {
    mockLocationEnabled = true
    // native returns a result
    mockReverseGeocodeAsync.mockResolvedValue([
      { name: 'Tiger Sugar', city: 'Perth', region: 'WA' },
    ])
    const renderer = renderAddModal()

    await act(async () => {
      await renderer.root.findByProps({ testID: 'locate-button' }).props.onPress()
    })

    expect(mockServerReverseGeocode).not.toHaveBeenCalled()
    const placeField = renderer.root.findByProps({ placeholder: 'Tiger Sugar · Hongdae' })
    expect(placeField.props.value).toBe('Tiger Sugar · Perth, WA')
  })

  it('shows loc_failed hint and save still works when getCurrentPosition times out', async () => {
    mockLocationEnabled = true
    // Never resolves — the 10s timeout in locateMe will win
    mockGetCurrentPositionAsync.mockReturnValue(new Promise(() => {}))
    const renderer = renderAddModal()

    const nameField = renderer.root.findByProps({ placeholder: 'Brown sugar boba' })
    const yumOption = pressableByText(renderer, 'YUM')
    const saveButton = pressableByText(renderer, 'Save taste')

    // Fire locate without awaiting — the promise will resolve once we advance timers
    let locatePromise!: Promise<void>
    act(() => {
      locatePromise = renderer.root.findByProps({ testID: 'locate-button' }).props.onPress() as Promise<void>
    })

    // Drain microtasks then advance past the 10s timeout
    await act(async () => {
      await Promise.resolve()
    })
    await act(async () => {
      jest.advanceTimersByTime(11_000)
      await locatePromise
    })

    // Failure hint shown
    expect(renderer.root.findAllByProps({ testID: 'loc-failed-hint' }).length).toBeGreaterThanOrEqual(1)
    // Recorded marker not shown
    expect(renderer.root.findAllByProps({ testID: 'loc-recorded-marker' })).toHaveLength(0)

    // Save still works without coords
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
      expect.objectContaining({ name: 'Brown sugar boba', verdict: 'yum', lat: null, lng: null }),
      null,
    )
  }, 30_000)

  it('shows loc_failed hint when getCurrentPosition rejects with a non-timeout error', async () => {
    mockLocationEnabled = true
    mockGetCurrentPositionAsync.mockRejectedValue(new Error('position_unavailable'))
    const renderer = renderAddModal()

    await act(async () => {
      await renderer.root.findByProps({ testID: 'locate-button' }).props.onPress()
    })

    expect(renderer.root.findAllByProps({ testID: 'loc-failed-hint' }).length).toBeGreaterThanOrEqual(1)
    expect(renderer.root.findAllByProps({ testID: 'loc-recorded-marker' })).toHaveLength(0)
  })

  it('clears stale coords after a later denied locate attempt', async () => {
    mockLocationEnabled = true
    mockRequestForegroundPermissionsAsync
      .mockResolvedValueOnce({ granted: true })
      .mockRejectedValueOnce(new Error('denied'))
    const renderer = renderAddModal()

    const nameField = renderer.root.findByProps({ placeholder: 'Brown sugar boba' })
    const yumOption = pressableByText(renderer, 'YUM')
    const saveButton = pressableByText(renderer, 'Save taste')

    await act(async () => {
      await renderer.root.findByProps({ testID: 'locate-button' }).props.onPress()
    })

    await act(async () => {
      await renderer.root.findByProps({ testID: 'locate-button' }).props.onPress()
    })

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
      expect.objectContaining({
        name: 'Brown sugar boba',
        verdict: 'yum',
        lat: null,
        lng: null,
      }),
      null,
    )
  })
})
