/* ============================================================
   Regression test — video silently saved as an image (user report 2026-06-15).

   Repro: pick a short clip, then the Add screen remounts mid-add (Android
   activity recreation after the picker/crop — the same storm behind the
   stuck-overlay bug). The autosaved draft restored `photo` (the extracted
   poster) but NOT the staged `clipUri`, so Save sent createTaste with no
   clipKey → the server stored an IMAGE row with the poster. The card showed
   a still frame with no play-overlay; the video was lost.

   The fix carries clipUri / clipDurationMs / clipContentType in the draft so
   the clip survives the remount and Save still uploads + submits a video.

   This test mounts AddModal, picks a clip, UNMOUNTS (the uncontrolled-exit
   safety-net autosaves the draft), REMOUNTS (the draft restores), then Saves
   and asserts a video record is submitted. Against the old draft shape the
   clip is dropped → createTaste.mediaType is undefined and this test FAILS.
   ============================================================ */

import TestRenderer, { act } from 'react-test-renderer'
import AsyncStorage from '@react-native-async-storage/async-storage'
import AddModal from '../AddModal'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockCreateTaste = jest.fn<any, any[]>()
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockRequestClipPresign = jest.fn<any, any[]>()
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockUploadToPresignedUrl = jest.fn<any, any[]>()

jest.mock('@yon/shared', () => ({
  TAG_CHOICES: ['Coffee', 'Boba'],
  createTaste: (a: unknown, b: unknown) => mockCreateTaste(a, b),
  createTag: jest.fn(),
  reverseGeocode: jest.fn(() => Promise.resolve({ place: null })),
  searchTastes: jest.fn(() => []),
  publishTasteGeo: jest.fn(),
  requestClipPresign: (a: unknown) => mockRequestClipPresign(a),
  uploadToPresignedUrl: (a: unknown, b: unknown, c: unknown) =>
    mockUploadToPresignedUrl(a, b, c),
}))

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockLaunchLibrary = jest.fn<any, any[]>()
jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(() => Promise.resolve({ granted: true })),
  launchImageLibraryAsync: (...args: unknown[]) => mockLaunchLibrary(...args),
  VideoExportPreset: { MediumQuality: 2 },
}))
jest.mock('expo-image-manipulator', () => ({}))

const mockExtractVideoPoster = jest.fn()
jest.mock('@/lib/extractVideoPoster', () => ({
  extractVideoPoster: (...args: unknown[]) => mockExtractVideoPoster(...args),
}))

jest.mock('@/app/(tabs)/_useTastes', () => ({
  invalidateTastes: jest.fn(async () => []),
  useRefreshableTastes: () => ({ items: [] }),
}))
jest.mock('@/app/(tabs)/_useTags', () => ({
  invalidateTagsCache: jest.fn(),
  useTags: () => ({ tags: [] }),
}))
jest.mock('@/app/(tabs)/_useActiveTaster', () => ({ useActiveTaster: () => null }))
jest.mock('@/app/(tabs)/_useTasters', () => ({
  useTasters: () => ({ tasters: [], loading: false }),
}))

jest.mock('@/providers/I18nProvider', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))
// A concrete user id so the draft key is namespaced like production and both
// mounts read/write the same draft.
jest.mock('@/providers/AuthProvider', () => ({
  useAuth: () => ({
    user: { id: 'u1', plan: 'pro', warningsEnabled: false, locationEnabled: false, defaultVisibility: 'private' },
  }),
}))
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }))
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 47, bottom: 0, left: 0, right: 0 }),
}))
jest.mock('expo-location', () => ({
  Accuracy: { High: 4 },
  requestForegroundPermissionsAsync: jest.fn(() => Promise.resolve({ granted: false })),
}))

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
    return <TextInput accessibilityLabel={label} value={value} onChangeText={onChangeText} testID={testID} />
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

const flush = () =>
  act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })

const mountedRenderers: TestRenderer.ReactTestRenderer[] = []

async function openModal() {
  let renderer!: TestRenderer.ReactTestRenderer
  await act(async () => {
    renderer = TestRenderer.create(<AddModal onClose={() => {}} onSaved={() => {}} />)
  })
  mountedRenderers.push(renderer)
  // Let the on-mount draft load settle (hydratedRef → true) so the unmount
  // safety-net is armed and any persisted draft is restored.
  await flush()
  return renderer
}

function fillReady(renderer: TestRenderer.ReactTestRenderer) {
  const nameInput = renderer.root.findAll((n) => n.props['accessibilityLabel'] === 'f_what')
  act(() => { nameInput[0].props.onChangeText('Iced tea clip') })
  const yumBtn = renderer.root.findAll((n) => n.props['data-verdict'] === 'yum')
  act(() => { yumBtn[0].props.onClick() })
}

async function tapAddVideo(renderer: TestRenderer.ReactTestRenderer) {
  const btn = renderer.root.findAll(
    (n) => String(n.type) === 'button' && n.props['data-testid'] === 'add-video-btn',
  )
  await act(async () => {
    await btn[0].props.onClick()
  })
}

async function tapSave(renderer: TestRenderer.ReactTestRenderer) {
  const save = renderer.root.findAll(
    (n) => String(n.type) === 'button' && n.props.children === 'save_taste_web' && typeof n.props.onClick === 'function',
  )
  await act(async () => {
    await save[0].props.onClick()
  })
}

beforeEach(async () => {
  jest.clearAllMocks()
  await AsyncStorage.clear()
  mockCreateTaste.mockResolvedValue({ id: 'new-id' })
  mockRequestClipPresign.mockResolvedValue({
    uploadUrl: 'https://r2.example/clip?sig=put',
    key: 'u/u1/clips/uuid/clip.mp4',
    headers: { 'Content-Type': 'video/mp4' },
  })
  mockUploadToPresignedUrl.mockResolvedValue(undefined)
})

afterEach(() => {
  act(() => {
    mountedRenderers.forEach((r) => {
      try { r.unmount() } catch { /* already unmounted */ }
    })
  })
  mountedRenderers.length = 0
})

describe('AddModal — staged video clip survives a remount mid-add', () => {
  it('restores clipUri from the autosaved draft so Save still uploads + submits a video', async () => {
    mockLaunchLibrary.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///tmp/clip.mp4', duration: 4_000, fileSize: 3_000_000 }],
    })
    mockExtractVideoPoster.mockResolvedValue({
      uri: 'file:///tmp/poster.jpg', name: 'poster.jpg', type: 'image/jpeg',
    })

    // Mount 1: fill + pick a clip, then the screen is torn down without a
    // controlled close (hardware back / Android activity recreation). The
    // safety-net autosaves the draft.
    const r1 = await openModal()
    fillReady(r1)
    await tapAddVideo(r1)
    expect(mockExtractVideoPoster).toHaveBeenCalledWith('file:///tmp/clip.mp4')

    await act(async () => { r1.unmount() })
    await flush()

    // Mount 2: the draft restores. The user taps Save without re-picking.
    const r2 = await openModal()
    await tapSave(r2)

    // The clip survived → it was uploaded and the record submitted as a video.
    expect(mockRequestClipPresign).toHaveBeenCalledWith({ kind: 'video', contentType: 'video/mp4' })
    expect(mockUploadToPresignedUrl).toHaveBeenCalledWith(
      'https://r2.example/clip?sig=put',
      { 'Content-Type': 'video/mp4' },
      'file:///tmp/clip.mp4',
    )
    const [input] = mockCreateTaste.mock.calls[0]
    expect(input.mediaType).toBe('video')
    expect(input.clipKey).toBe('u/u1/clips/uuid/clip.mp4')
    expect(input.durationMs).toBe(4_000)
  })
})
