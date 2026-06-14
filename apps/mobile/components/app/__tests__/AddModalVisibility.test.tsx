/* ============================================================
   Regression test — AddModal per-record visibility selector (S3c).

   The Add screen exposes a private / "Nearby" (public) selector seeded from the
   account default (user.defaultVisibility). When the user keeps/chooses "Nearby"
   AND a location was captured, saving the record must PUBLISH it to the geo feed
   via the existing publishTasteGeo (PATCH /api/tastes/:id/visibility) — a
   create-then-publish step, because createTaste can't publish a record that
   doesn't have an id/coords yet.

   Pins:
   - The selector renders, seeded from defaultVisibility ('shared' → public
     pre-selected; effective only once coords exist).
   - With default 'shared' + coords captured, Save calls createTaste AND then
     publishTasteGeo(newId). Pins the exact publish call + arg.
   - With default 'private', Save does NOT publish (publishTasteGeo never called).
   - With no location, the public option is disabled (a location-less record
     can't geo-publish) and Save never publishes even if the seed was 'shared'.

   FAILS today: AddModal has no visibility selector and never calls
   publishTasteGeo. PASSES once S3c wires the selector + create-then-publish.

   Harness mirrors AddModalTaster.test.tsx.
   ============================================================ */

import TestRenderer, { act } from 'react-test-renderer'
import AddModal from '../AddModal'

// ---- mock react-native ----------------------------------------------------

jest.mock('react-native', () => {
  const actual = jest.requireActual('react-native')
  return new Proxy(actual, {
    get(target, prop, receiver) {
      if (prop === 'KeyboardAvoidingView') {
        return ({ children }: { children: React.ReactNode }) => children
      }
      if (prop === 'ScrollView') {
        return ({ children }: { children: React.ReactNode }) => <div>{children}</div>
      }
      return Reflect.get(target, prop, receiver)
    },
  })
})

// ---- mock shared ----------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockCreateTaste = jest.fn<any, any[]>()
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockSearchTastes = jest.fn<any, any[]>(() => [])
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockCreateTag = jest.fn<any, any[]>()
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockReverseGeocode = jest.fn<any, any[]>(() => Promise.resolve({ place: null }))
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockPublishTasteGeo = jest.fn<any, any[]>()

jest.mock('@yon/shared', () => ({
  TAG_CHOICES: ['Coffee', 'Boba'],
  createTaste: (a: unknown, b: unknown) => mockCreateTaste(a, b),
  createTag: (a: unknown) => mockCreateTag(a),
  reverseGeocode: (a: unknown, b: unknown) => mockReverseGeocode(a, b),
  searchTastes: (a: unknown) => mockSearchTastes(a),
  publishTasteGeo: (a: unknown) => mockPublishTasteGeo(a),
}))

// ---- mock hooks -----------------------------------------------------------

jest.mock('@/app/(tabs)/_useTastes', () => ({
  invalidateTastes: jest.fn(),
  useRefreshableTastes: () => ({ items: [] }),
}))

jest.mock('@/app/(tabs)/_useTags', () => ({
  invalidateTagsCache: jest.fn(),
  useTags: () => ({ tags: [] }),
}))

jest.mock('@/app/(tabs)/_useActiveTaster', () => ({
  useActiveTaster: () => null,
}))

jest.mock('@/app/(tabs)/_useTasters', () => ({
  useTasters: () => ({ tasters: [], loading: false }),
}))

// ---- mock providers -------------------------------------------------------

jest.mock('@/providers/I18nProvider', () => ({
  useI18n: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        f_what: 'What?',
        save_taste_web: 'Save',
        v_yum: 'YUM', v_meh: 'MEH', v_nah: 'NAH',
        vis_private: 'Private', vis_public: 'Nearby',
        vis_publish_failed: 'Saved — but could not publish to Nearby. You can retry from the record.',
        loc_use_location: 'Use current location',
      }
      return map[key] ?? key
    },
  }),
}))

// defaultVisibility is varied per test via this mutable holder.
const authUser: {
  plan: string
  warningsEnabled: boolean
  locationEnabled: boolean
  defaultVisibility: 'private' | 'shared'
} = { plan: 'free', warningsEnabled: true, locationEnabled: true, defaultVisibility: 'private' }
jest.mock('@/providers/AuthProvider', () => ({
  useAuth: () => ({ user: authUser }),
}))

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn() }),
}))

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 47, bottom: 0, left: 0, right: 0 }),
}))

// expo-location: granted + a fixed fix so locateMe captures coords.
jest.mock('expo-location', () => ({
  Accuracy: { High: 4 },
  requestForegroundPermissionsAsync: jest.fn(() => Promise.resolve({ granted: true })),
  hasServicesEnabledAsync: jest.fn(() => Promise.resolve(true)),
  getLastKnownPositionAsync: jest.fn(() => Promise.resolve(null)),
  getCurrentPositionAsync: jest.fn(() =>
    Promise.resolve({ coords: { latitude: 35.0, longitude: 139.0 } }),
  ),
  reverseGeocodeAsync: jest.fn(() => Promise.resolve([])),
}))
jest.mock('expo-image-picker', () => ({}))
jest.mock('expo-image-manipulator', () => ({}))
// react-native-reanimated: use the global __mocks__/react-native-reanimated.js
// (mapped via moduleNameMapper in jest.config.js). It exports Animated.View as
// React.createElement('View', ...) which the test-renderer can reconcile cleanly.
// Do NOT override with an inline jest.mock here — the inline factory runs hoisted
// (before Babel transforms apply to the factory body), so JSX inside it can fail
// to compile, and the global mock is already correct for tests.

// ---- mock ds components ---------------------------------------------------

jest.mock('@/components/ds', () => ({
  Button: ({ children, onPress, disabled, testID }: {
    children: React.ReactNode; onPress?: () => void; disabled?: boolean; testID?: string
  }) => (
    <button onClick={onPress} disabled={disabled} data-testid={testID}>{children}</button>
  ),
  Icon: ({ name }: { name: string }) => <span data-icon={name} />,
  IconButton: ({ children, onPress }: { children: React.ReactNode; onPress?: () => void }) => (
    <button onClick={onPress}>{children}</button>
  ),
  Input: ({ value, onChangeText, label, testID }: {
    value: string; onChangeText?: (t: string) => void; label?: string; testID?: string
  }) => {
    const { TextInput } = require('react-native')
    return (
      <TextInput accessibilityLabel={label} value={value} onChangeText={onChangeText} testID={testID} />
    )
  },
  Tag: ({ children, active, onPress }: {
    children: React.ReactNode; active?: boolean; onPress?: () => void
  }) => <span data-active={active} onClick={onPress}>{children}</span>,
  Textarea: ({ value, onChangeText }: { value: string; onChangeText?: (t: string) => void }) => (
    <textarea value={value} onChange={(e) => onChangeText?.(e.target.value)} />
  ),
  VerdictPicker: ({ value, onChange }: { value: string | null; onChange: (v: string) => void }) => (
    <div data-testid="verdict-picker" data-value={value}>
      {(['yum', 'meh', 'nah'] as const).map((v) => (
        <button key={v} data-verdict={v} onClick={() => onChange(v)}>{v}</button>
      ))}
    </div>
  ),
  VerdictStamp: ({ verdict }: { verdict: string }) => <span data-verdict={verdict} />,
}))

jest.mock('../PhotoPreview', () => ({ PhotoPreview: () => null }))

// ---- helpers --------------------------------------------------------------

let currentRenderer: TestRenderer.ReactTestRenderer | null = null

function renderModal() {
  const onClose = jest.fn()
  const onSaved = jest.fn()
  let renderer!: TestRenderer.ReactTestRenderer
  act(() => {
    renderer = TestRenderer.create(<AddModal onClose={onClose} onSaved={onSaved} />)
  })
  currentRenderer = renderer
  return { renderer, onSaved }
}

function findSaveButton(renderer: TestRenderer.ReactTestRenderer) {
  return renderer.root.findAll(
    (n) =>
      (String(n.type) === 'button' || String(n.type) === 'Button') &&
      n.props.children === 'Save',
  )
}

function findByTestID(renderer: TestRenderer.ReactTestRenderer, id: string) {
  return renderer.root.findAll((n) => n.props.testID === id || n.props['data-testid'] === id)
}

function fillReady(renderer: TestRenderer.ReactTestRenderer) {
  const nameInput = renderer.root.findAll((n) => n.props['accessibilityLabel'] === 'What?')
  act(() => { nameInput[0].props.onChangeText('Cortado') })
  const yumBtn = renderer.root.findAll((n) => n.props['data-verdict'] === 'yum')
  act(() => { yumBtn[0].props.onClick() })
}

/** Click "Use current location" and let the async location flow settle so
 *  lat/lng are captured (35.0, 139.0). */
async function captureLocation(renderer: TestRenderer.ReactTestRenderer) {
  // The mocked Button renders a host <button data-testid> with an onClick; match
  // the clickable host node (the component instance carries onPress, not onClick).
  const locate = renderer.root.findAll(
    (n) => String(n.type) === 'button' && n.props['data-testid'] === 'locate-button',
  )
  await act(async () => { locate[0].props.onClick() })
  // Allow the geocode microtasks chained after setLat/setLng to flush.
  await act(async () => { await Promise.resolve() })
  await act(async () => { await Promise.resolve() })
}

// ---- tests ----------------------------------------------------------------

describe('AddModal — per-record visibility (S3c)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockCreateTaste.mockResolvedValue({ id: 'new-id' })
    mockPublishTasteGeo.mockResolvedValue({ id: 'new-id', visibility: 'shared' })
    authUser.defaultVisibility = 'private'
  })

  afterEach(() => {
    act(() => { currentRenderer?.unmount() })
    currentRenderer = null
  })

  it('renders the visibility selector', () => {
    const { renderer } = renderModal()
    expect(findByTestID(renderer, 'add-visibility-selector').length).toBeGreaterThan(0)
    expect(findByTestID(renderer, 'add-visibility-public-btn').length).toBeGreaterThan(0)
    expect(findByTestID(renderer, 'add-visibility-private-btn').length).toBeGreaterThan(0)
  })

  it('seeded from default_visibility=shared + coords → Save publishes the new record to geo', async () => {
    authUser.defaultVisibility = 'shared'
    const { renderer } = renderModal()
    fillReady(renderer)
    await captureLocation(renderer)

    const save = findSaveButton(renderer)
    await act(async () => { save[0].props.onClick() })

    expect(mockCreateTaste).toHaveBeenCalledTimes(1)
    // The record was published via the existing geo-publish API with the new id.
    expect(mockPublishTasteGeo).toHaveBeenCalledTimes(1)
    expect(mockPublishTasteGeo).toHaveBeenCalledWith('new-id')
  })

  it('default_visibility=private → Save does NOT publish', async () => {
    authUser.defaultVisibility = 'private'
    const { renderer } = renderModal()
    fillReady(renderer)
    await captureLocation(renderer)

    const save = findSaveButton(renderer)
    await act(async () => { save[0].props.onClick() })

    expect(mockCreateTaste).toHaveBeenCalledTimes(1)
    expect(mockPublishTasteGeo).not.toHaveBeenCalled()
  })

  it('publishTasteGeo rejects → modal stays open (error visible), onSaved NOT called', async () => {
    // Pins the "fail explicitly" contract: when the user chose Nearby and the
    // publish fails, the modal must STAY OPEN so the error message is actually
    // visible. The previous fix called onSaved after setError, which unmounted
    // the modal before the error painted — the user was STILL not informed.
    //
    // RED (old fire-and-forget): error never set, so errorNodes.length === 0.
    // RED (previous fix): onSaved called immediately after setError, unmounting
    //   the modal — test would have passed only because onSaved is an inert mock
    //   that doesn't unmount. The assertion `expect(onSaved).not.toHaveBeenCalled()`
    //   fails the previous fix, making the real regression detectable.
    // GREEN (this fix): error shown AND onSaved not called (modal open).
    authUser.defaultVisibility = 'shared'
    mockPublishTasteGeo.mockRejectedValueOnce(new Error('network error'))
    const { renderer, onSaved } = renderModal()
    fillReady(renderer)
    await captureLocation(renderer)

    const save = findSaveButton(renderer)
    await act(async () => { save[0].props.onClick() })

    // createTaste was called (record is persisted server-side).
    expect(mockCreateTaste).toHaveBeenCalledTimes(1)
    // publishTasteGeo was attempted then rejected.
    expect(mockPublishTasteGeo).toHaveBeenCalledTimes(1)
    // Error message is visible in the still-open modal.
    const errorNodes = renderer.root.findAll(
      (n) => typeof n.props.children === 'string' &&
        (n.props.children as string).includes('Saved — but could not publish'),
    )
    expect(errorNodes.length).toBeGreaterThan(0)
    // CRITICAL: onSaved must NOT have been called — the modal must stay open so
    // the error is visible. Calling onSaved would unmount the modal (navigating
    // away) before the error paints, making the message invisible to the user.
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('no location → public is disabled and Save never publishes even when seed was shared', async () => {
    authUser.defaultVisibility = 'shared'
    const { renderer } = renderModal()
    fillReady(renderer)
    // No captureLocation — record has no coords.

    const publicBtn = findByTestID(renderer, 'add-visibility-public-btn')
    expect(publicBtn[0].props.disabled).toBe(true)
    expect(findByTestID(renderer, 'add-visibility-no-location-hint').length).toBeGreaterThan(0)

    const save = findSaveButton(renderer)
    await act(async () => { save[0].props.onClick() })

    expect(mockCreateTaste).toHaveBeenCalledTimes(1)
    expect(mockPublishTasteGeo).not.toHaveBeenCalled()
  })
})
