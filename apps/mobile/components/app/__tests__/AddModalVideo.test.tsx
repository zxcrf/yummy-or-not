/* ============================================================
   S3b Phase 2 — AddModal video capture + upload (D1 / D4).

   Behavior under test:
   - Caps reject (client, pre-upload): a clip with duration > 15s shows an inline
     error and stages NO clip → Save uploads nothing as video. Same for a file
     size > 20MB.
   - Poster-extract failure is NON-blocking: the clip is still staged + uploaded
     and the record is submitted as video with NO poster photo (the card shows a
     play-button placeholder).
   - A good pick → poster extract → Save uploads the clip via
     requestClipPresign → uploadToPresignedUrl and submits createTaste with
     mediaType:'video' + the SERVER clipKey + durationMs + the poster as `photo`.

   Mount mirrors AddModalVisibility.test.tsx (sync act create — AddModal's only
   async-on-mount is the draft load, already covered by the baseline). The
   pick + save handlers are awaited inside `await act(async () => …)` so their
   promise chains drain in-act (act-gate stays at baseline).
   ============================================================ */

import TestRenderer, { act } from 'react-test-renderer'
import AddModal from '../AddModal'

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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockRequestClipPresign = jest.fn<any, any[]>()
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockUploadToPresignedUrl = jest.fn<any, any[]>()

jest.mock('@yon/shared', () => ({
  TAG_CHOICES: ['Coffee', 'Boba'],
  createTaste: (a: unknown, b: unknown) => mockCreateTaste(a, b),
  createTag: (a: unknown) => mockCreateTag(a),
  reverseGeocode: (a: unknown, b: unknown) => mockReverseGeocode(a, b),
  searchTastes: (a: unknown) => mockSearchTastes(a),
  publishTasteGeo: (a: unknown) => mockPublishTasteGeo(a),
  requestClipPresign: (a: unknown) => mockRequestClipPresign(a),
  uploadToPresignedUrl: (a: unknown, b: unknown, c: unknown) =>
    mockUploadToPresignedUrl(a, b, c),
}))

// ---- mock the video picker + poster extractor -----------------------------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockRequestPerms = jest.fn<any, any[]>(() => Promise.resolve({ granted: true }))
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockLaunchLibrary = jest.fn<any, any[]>()
jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: (...args: unknown[]) => mockRequestPerms(...args),
  launchImageLibraryAsync: (...args: unknown[]) => mockLaunchLibrary(...args),
  VideoExportPreset: { MediumQuality: 2 },
}))
jest.mock('expo-image-manipulator', () => ({}))

const mockExtractVideoPoster = jest.fn()
jest.mock('@/lib/extractVideoPoster', () => ({
  extractVideoPoster: (...args: unknown[]) => mockExtractVideoPoster(...args),
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
jest.mock('@/app/(tabs)/_useActiveTaster', () => ({ useActiveTaster: () => null }))
jest.mock('@/app/(tabs)/_useTasters', () => ({
  useTasters: () => ({ tasters: [], loading: false }),
}))

jest.mock('@/providers/I18nProvider', () => ({
  useI18n: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        f_what: 'What?',
        save_taste_web: 'Save',
        add_video: 'Add video',
        video_too_long: 'Videos must be 15 seconds or shorter.',
        video_too_large: 'That video is too large (max 20 MB).',
        v_yum: 'YUM', v_meh: 'MEH', v_nah: 'NAH',
      }
      return map[key] ?? key
    },
  }),
}))

jest.mock('@/providers/AuthProvider', () => ({
  useAuth: () => ({
    user: { plan: 'pro', warningsEnabled: false, locationEnabled: false, defaultVisibility: 'private' },
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

// ---- helpers --------------------------------------------------------------
const mountedRenderers: TestRenderer.ReactTestRenderer[] = []

function renderModal() {
  const onClose = jest.fn()
  const onSaved = jest.fn()
  let renderer!: TestRenderer.ReactTestRenderer
  act(() => {
    renderer = TestRenderer.create(<AddModal onClose={onClose} onSaved={onSaved} />)
  })
  mountedRenderers.push(renderer)
  return { renderer, onSaved }
}

function findSaveButton(renderer: TestRenderer.ReactTestRenderer) {
  // Host <button data-testid=undefined> nodes carry onClick; the composite
  // Button instance carries onPress. Match the host node so .onClick() works.
  return renderer.root.findAll(
    (n) => String(n.type) === 'button' && n.props.children === 'Save' && typeof n.props.onClick === 'function',
  )
}

function fillReady(renderer: TestRenderer.ReactTestRenderer) {
  const nameInput = renderer.root.findAll((n) => n.props['accessibilityLabel'] === 'What?')
  act(() => { nameInput[0].props.onChangeText('Ramen pull') })
  const yumBtn = renderer.root.findAll((n) => n.props['data-verdict'] === 'yum')
  act(() => { yumBtn[0].props.onClick() })
}

async function tapAddVideo(renderer: TestRenderer.ReactTestRenderer) {
  // The mocked Button renders a host <button data-testid> carrying onClick; the
  // composite Button instance carries onPress instead — match the host node.
  const btn = renderer.root.findAll(
    (n) => String(n.type) === 'button' && n.props['data-testid'] === 'add-video-btn',
  )
  await act(async () => {
    await btn[0].props.onClick()
  })
}

async function tapSave(renderer: TestRenderer.ReactTestRenderer) {
  const save = findSaveButton(renderer)
  await act(async () => {
    await save[0].props.onClick()
  })
}

afterEach(() => {
  act(() => { mountedRenderers.forEach((r) => r.unmount()) })
  mountedRenderers.length = 0
  jest.clearAllMocks()
  mockCreateTaste.mockResolvedValue({ id: 'new-id' })
  mockRequestPerms.mockResolvedValue({ granted: true })
})

beforeEach(() => {
  mockCreateTaste.mockResolvedValue({ id: 'new-id' })
  mockRequestPerms.mockResolvedValue({ granted: true })
})

// ---- tests ----------------------------------------------------------------

describe('AddModal — video capture caps (D1)', () => {
  it('rejects a clip longer than 15s: inline error, no clip staged, no upload on Save', async () => {
    mockLaunchLibrary.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///tmp/long.mp4', duration: 16_000, fileSize: 1_000_000 }],
    })
    const { renderer } = renderModal()
    fillReady(renderer)
    await tapAddVideo(renderer)

    // The poster extractor was never reached (cap rejected before extraction).
    expect(mockExtractVideoPoster).not.toHaveBeenCalled()
    // Inline error visible.
    const err = renderer.root.findAll(
      (n) => typeof n.props.children === 'string' &&
        (n.props.children as string).includes('15 seconds or shorter'),
    )
    expect(err.length).toBeGreaterThan(0)

    await tapSave(renderer)
    // Saved as a plain (no-video) record: no clip presign / upload, and
    // createTaste was not called with a video mediaType.
    expect(mockRequestClipPresign).not.toHaveBeenCalled()
    expect(mockUploadToPresignedUrl).not.toHaveBeenCalled()
    expect(mockCreateTaste.mock.calls[0][0].mediaType).toBeUndefined()
  })

  it('rejects a clip larger than 20MB: inline error, no clip staged', async () => {
    mockLaunchLibrary.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///tmp/big.mp4', duration: 5_000, fileSize: 21 * 1024 * 1024 }],
    })
    const { renderer } = renderModal()
    fillReady(renderer)
    await tapAddVideo(renderer)

    expect(mockExtractVideoPoster).not.toHaveBeenCalled()
    const err = renderer.root.findAll(
      (n) => typeof n.props.children === 'string' &&
        (n.props.children as string).includes('too large'),
    )
    expect(err.length).toBeGreaterThan(0)

    await tapSave(renderer)
    expect(mockRequestClipPresign).not.toHaveBeenCalled()
  })
})

describe('AddModal — video submit (D1)', () => {
  it('good pick → poster extract → Save uploads clip + submits video taste', async () => {
    mockLaunchLibrary.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///tmp/clip.mp4', duration: 12_000, fileSize: 5_000_000 }],
    })
    mockExtractVideoPoster.mockResolvedValue({
      uri: 'file:///tmp/poster.jpg', name: 'poster.jpg', type: 'image/jpeg',
    })
    mockRequestClipPresign.mockResolvedValue({
      uploadUrl: 'https://r2.example/u/u1/clips/uuid/clip.mp4?sig=put',
      key: 'u/u1/clips/uuid/clip.mp4',
      headers: { 'Content-Type': 'video/mp4' },
    })
    mockUploadToPresignedUrl.mockResolvedValue(undefined)

    const { renderer } = renderModal()
    fillReady(renderer)
    await tapAddVideo(renderer)

    // Poster was extracted from the picked clip uri.
    expect(mockExtractVideoPoster).toHaveBeenCalledWith('file:///tmp/clip.mp4')

    await tapSave(renderer)

    // Presign asked for a video clip; the client never supplied the key.
    expect(mockRequestClipPresign).toHaveBeenCalledWith({
      kind: 'video', contentType: 'video/mp4',
    })
    // The clip was PUT to the presigned url with its local uri.
    expect(mockUploadToPresignedUrl).toHaveBeenCalledWith(
      'https://r2.example/u/u1/clips/uuid/clip.mp4?sig=put',
      { 'Content-Type': 'video/mp4' },
      'file:///tmp/clip.mp4',
    )
    // createTaste got mediaType/clipKey/durationMs + the poster as `photo`.
    const [input, photo] = mockCreateTaste.mock.calls[0]
    expect(input.mediaType).toBe('video')
    expect(input.clipKey).toBe('u/u1/clips/uuid/clip.mp4')
    expect(input.durationMs).toBe(12_000)
    expect(photo).toEqual({
      uri: 'file:///tmp/poster.jpg', name: 'poster.jpg', type: 'image/jpeg',
    })
  })

  it('poster-extract failure is non-blocking: clip still uploads, video submitted with no poster', async () => {
    mockLaunchLibrary.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///tmp/clip.mp4', duration: 8_000, fileSize: 3_000_000 }],
    })
    // Poster extraction failed → null (generic placeholder, still upload).
    mockExtractVideoPoster.mockResolvedValue(null)
    mockRequestClipPresign.mockResolvedValue({
      uploadUrl: 'https://r2.example/clip?sig=put',
      key: 'u/u1/clips/uuid/clip.mp4',
      headers: { 'Content-Type': 'video/mp4' },
    })
    mockUploadToPresignedUrl.mockResolvedValue(undefined)

    const { renderer } = renderModal()
    fillReady(renderer)
    await tapAddVideo(renderer)
    await tapSave(renderer)

    // Clip still uploaded + record still submitted as video.
    expect(mockUploadToPresignedUrl).toHaveBeenCalledTimes(1)
    const [input, photo] = mockCreateTaste.mock.calls[0]
    expect(input.mediaType).toBe('video')
    expect(input.clipKey).toBe('u/u1/clips/uuid/clip.mp4')
    // No poster was extracted → photo is null (card shows a placeholder).
    expect(photo).toBeNull()
  })
})

describe('AddModal — zero/missing duration guard (MED fix)', () => {
  it('rejects a clip with duration: 0 — no upload, inline error shown, Save sends no clip', async () => {
    // A picker asset that returns duration=0 (e.g. corrupted or unsupported
    // format) must be rejected before any network call. Previously the guard
    // was `durationMs > CLIP_MAX_MS` which allowed 0 through; the fix adds
    // `durationMs <= 0` to the condition. This test FAILS without that fix.
    mockLaunchLibrary.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///tmp/zero.mp4', duration: 0, fileSize: 1_000_000 }],
    })
    const { renderer } = renderModal()
    fillReady(renderer)
    await tapAddVideo(renderer)

    // Poster extractor never called — rejected before extraction.
    expect(mockExtractVideoPoster).not.toHaveBeenCalled()
    // Inline error visible (same message key as >15s — "too long / unknown").
    const err = renderer.root.findAll(
      (n) => typeof n.props.children === 'string' &&
        (n.props.children as string).includes('15 seconds or shorter'),
    )
    expect(err.length).toBeGreaterThan(0)

    await tapSave(renderer)
    // No presign / upload attempted; createTaste has no video fields.
    expect(mockRequestClipPresign).not.toHaveBeenCalled()
    expect(mockUploadToPresignedUrl).not.toHaveBeenCalled()
    expect(mockCreateTaste.mock.calls[0][0].mediaType).toBeUndefined()
  })

  it('rejects a clip with duration: undefined — no upload, inline error shown, Save sends no clip', async () => {
    // asset.duration can be undefined when the picker cannot determine length
    // (some Android codecs). The `?? 0` coercion then hits the `<= 0` guard.
    // This test FAILS if the guard is reverted to `> CLIP_MAX_MS` only.
    mockLaunchLibrary.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///tmp/nodur.mp4', duration: undefined, fileSize: 2_000_000 }],
    })
    const { renderer } = renderModal()
    fillReady(renderer)
    await tapAddVideo(renderer)

    expect(mockExtractVideoPoster).not.toHaveBeenCalled()
    const err = renderer.root.findAll(
      (n) => typeof n.props.children === 'string' &&
        (n.props.children as string).includes('15 seconds or shorter'),
    )
    expect(err.length).toBeGreaterThan(0)

    await tapSave(renderer)
    expect(mockRequestClipPresign).not.toHaveBeenCalled()
    expect(mockUploadToPresignedUrl).not.toHaveBeenCalled()
    expect(mockCreateTaste.mock.calls[0][0].mediaType).toBeUndefined()
  })
})

describe('AddModal — content-type derivation (MED fix)', () => {
  it('uses asset.mimeType video/quicktime when URI has no recognisable suffix', async () => {
    // Temp URIs from some pickers omit the extension entirely. Previously the
    // code derived type solely from URI suffix → would produce video/mp4 for a
    // QuickTime clip. The fix checks mimeType first. FAILS if order reverted.
    mockLaunchLibrary.mockResolvedValue({
      canceled: false,
      assets: [{
        uri: 'file:///tmp/PHAsset-uuid-no-ext',  // no suffix
        mimeType: 'video/quicktime',
        duration: 7_000,
        fileSize: 4_000_000,
      }],
    })
    mockExtractVideoPoster.mockResolvedValue(null)
    mockRequestClipPresign.mockResolvedValue({
      uploadUrl: 'https://r2.example/clip?sig=put',
      key: 'u/u1/clips/uuid/clip.mov',
      headers: { 'Content-Type': 'video/quicktime' },
    })
    mockUploadToPresignedUrl.mockResolvedValue(undefined)

    const { renderer } = renderModal()
    fillReady(renderer)
    await tapAddVideo(renderer)
    await tapSave(renderer)

    // The presign must have been called with video/quicktime, NOT video/mp4.
    expect(mockRequestClipPresign).toHaveBeenCalledWith({
      kind: 'video',
      contentType: 'video/quicktime',
    })
  })

  it('falls back to fileName extension (.mov) when mimeType is absent', async () => {
    // When mimeType is missing the code falls back to the fileName extension.
    // A fileName of "clip.mov" must yield video/quicktime.
    // FAILS if the fallback chain is removed.
    mockLaunchLibrary.mockResolvedValue({
      canceled: false,
      assets: [{
        uri: 'file:///tmp/PHAsset-uuid-no-ext',  // no suffix on URI
        mimeType: undefined,
        fileName: 'clip.mov',
        duration: 5_000,
        fileSize: 2_000_000,
      }],
    })
    mockExtractVideoPoster.mockResolvedValue(null)
    mockRequestClipPresign.mockResolvedValue({
      uploadUrl: 'https://r2.example/clip?sig=put',
      key: 'u/u1/clips/uuid/clip.mov',
      headers: { 'Content-Type': 'video/quicktime' },
    })
    mockUploadToPresignedUrl.mockResolvedValue(undefined)

    const { renderer } = renderModal()
    fillReady(renderer)
    await tapAddVideo(renderer)
    await tapSave(renderer)

    expect(mockRequestClipPresign).toHaveBeenCalledWith({
      kind: 'video',
      contentType: 'video/quicktime',
    })
  })
})
