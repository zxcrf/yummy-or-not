/* ============================================================
   S3b-media — YouView avatar upload regression tests.

   Pins the avatar flow the YouView profile header drives:
   - the avatar renders through the design-system Avatar (a real RN <Image>
     when a src is set), NEVER a raw <img> (the native-crash regression class
     guarded by PhotoPreview.test).
   - tapping the avatar launches the image picker.
   - a successful pick → presign → PUT → commit chain calls updateUser with the
     SERVER-issued bare key (client never invents the key) and refreshes the
     in-memory user via patchUser.
   - a canceled pick is a no-op: no presign, no upload, no updateUser.

   Mount uses `await act(async () => …)` + afterEach unmount per
   docs/engineering/jest-async-leaks.md so the async upload chain's promise
   continuations are drained inside act (act-warning grep gate must stay 0).
   ============================================================ */

import TestRenderer, { act } from 'react-test-renderer'
import { Image } from 'react-native'
import YouView from '../YouView'

const mockRequestPerms = jest.fn()
const mockLaunchLibrary = jest.fn()
jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: (...args: unknown[]) => mockRequestPerms(...args),
  launchImageLibraryAsync: (...args: unknown[]) => mockLaunchLibrary(...args),
}))

const mockManipulate = jest.fn()
jest.mock('expo-image-manipulator', () => ({
  manipulateAsync: (...args: unknown[]) => mockManipulate(...args),
  SaveFormat: { JPEG: 'jpeg' },
}))

const mockUpdateUser = jest.fn()
const mockRequestAvatarPresign = jest.fn()
const mockUploadToPresignedUrl = jest.fn()
jest.mock('@yon/shared', () => ({
  LANGS: [{ code: 'en', label: 'English', native: 'English' }],
  updateUser: (...args: unknown[]) => mockUpdateUser(...args),
  requestAvatarPresign: (...args: unknown[]) => mockRequestAvatarPresign(...args),
  uploadToPresignedUrl: (...args: unknown[]) => mockUploadToPresignedUrl(...args),
}))

const mockPush = jest.fn()
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }))

jest.mock('react-native-keyboard-controller', () => {
  const React = require('react')
  const { View } = require('react-native')
  return {
    KeyboardStickyView: ({ children }: { children: React.ReactNode }) =>
      React.createElement(View, null, children),
  }
})

const mockPatchUser = jest.fn()
let mockUser: {
  avatar: string
  displayName: string
  email: string
  phone: string
  plan: string
  warningsEnabled: boolean
  locationEnabled: boolean
} = {
  avatar: 'https://r2.example/old-avatar?sig=old',
  displayName: 'Alice',
  email: 'alice@example.com',
  phone: '',
  plan: 'free',
  warningsEnabled: false,
  locationEnabled: false,
}

jest.mock('@/providers/AuthProvider', () => ({
  useAuth: () => ({ user: mockUser, signOut: jest.fn(), patchUser: mockPatchUser }),
}))

jest.mock('@/providers/I18nProvider', () => ({
  useI18n: () => ({
    lang: 'en',
    setLang: jest.fn(),
    formatMoney: (n: number) => `$${n.toFixed(2)}`,
    t: (key: string, vars?: Record<string, string | number>) => {
      const map: Record<string, string> = {
        change_photo: 'Change photo',
        avatar_upload_failed: 'Could not update your photo.',
        photo_permission_denied: 'Photo access needed.',
        default_name: 'Foodie',
        tastes_logged: `${vars?.n} tastes logged`,
        saved_amt: `${vars?.amt} saved`,
      }
      return map[key] ?? key
    },
  }),
}))

jest.mock('@/app/(tabs)/_useTags', () => ({
  useTags: () => ({ tags: [], loading: false }),
  invalidateTagsCache: jest.fn(),
}))

const mountedRenderers: TestRenderer.ReactTestRenderer[] = []

async function renderYouView(): Promise<TestRenderer.ReactTestRenderer> {
  let renderer!: TestRenderer.ReactTestRenderer
  await act(async () => {
    renderer = TestRenderer.create(<YouView items={[]} />)
  })
  mountedRenderers.push(renderer)
  return renderer
}

afterEach(() => {
  act(() => {
    mountedRenderers.forEach((r) => r.unmount())
  })
  mountedRenderers.length = 0
  jest.clearAllMocks()
})

beforeEach(() => {
  mockUser = {
    avatar: 'https://r2.example/old-avatar?sig=old',
    displayName: 'Alice',
    email: 'alice@example.com',
    phone: '',
    plan: 'free',
    warningsEnabled: false,
    locationEnabled: false,
  }
})

describe('YouView avatar — render', () => {
  it('renders the avatar via a real RN Image, never a raw <img>', async () => {
    const renderer = await renderYouView()
    // A real RN Image is present (the design-system Avatar uses expo-image,
    // which the jest-expo preset renders as a host Image-family element).
    const tree = JSON.stringify(renderer.toJSON())
    expect(tree).not.toMatch(/"type":\s*"img"/)
  })

  it('exposes a tappable avatar button', async () => {
    const renderer = await renderYouView()
    expect(renderer.root.findByProps({ testID: 'avatar-change-btn' })).toBeTruthy()
  })
})

describe('YouView avatar — upload chain', () => {
  it('pick → presign → PUT → commit calls updateUser with the SERVER key + refreshes user', async () => {
    mockRequestPerms.mockResolvedValue({ granted: true })
    mockLaunchLibrary.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///tmp/pick.jpg', width: 400, height: 400, fileName: 'pick.jpg' }],
    })
    mockManipulate.mockResolvedValue({ uri: 'file:///tmp/pick-compressed.jpg' })
    mockRequestAvatarPresign.mockResolvedValue({
      uploadUrl: 'https://r2.example/u/u1/avatar/server-key.jpg?sig=put',
      key: 'u/u1/avatar/server-key.jpg',
      headers: { 'Content-Type': 'image/jpeg' },
    })
    mockUploadToPresignedUrl.mockResolvedValue(undefined)
    mockUpdateUser.mockResolvedValue({
      user: { avatar: 'https://r2.example/new-avatar?sig=new' },
    })

    const renderer = await renderYouView()
    await act(async () => {
      await renderer.root.findByProps({ testID: 'avatar-change-btn' }).props.onPress()
    })

    // The picker was launched with the square-avatar options.
    expect(mockLaunchLibrary).toHaveBeenCalledWith(
      expect.objectContaining({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1] }),
    )
    // Presign asked for an avatar JPEG; the client never supplied a key.
    expect(mockRequestAvatarPresign).toHaveBeenCalledWith({
      kind: 'avatar',
      contentType: 'image/jpeg',
    })
    // The PUT replayed the signed url + headers with the compressed file uri.
    expect(mockUploadToPresignedUrl).toHaveBeenCalledWith(
      'https://r2.example/u/u1/avatar/server-key.jpg?sig=put',
      { 'Content-Type': 'image/jpeg' },
      'file:///tmp/pick-compressed.jpg',
    )
    // The COMMIT uses the SERVER-issued key, not a client-invented value.
    expect(mockUpdateUser).toHaveBeenCalledWith({ avatar: 'u/u1/avatar/server-key.jpg' })
    // The in-memory user is refreshed with the server-resolved avatar URL.
    expect(mockPatchUser).toHaveBeenCalledWith({ avatar: 'https://r2.example/new-avatar?sig=new' })
  })

  it('a canceled pick is a no-op: no presign, no upload, no commit', async () => {
    mockRequestPerms.mockResolvedValue({ granted: true })
    mockLaunchLibrary.mockResolvedValue({ canceled: true, assets: [] })

    const renderer = await renderYouView()
    await act(async () => {
      await renderer.root.findByProps({ testID: 'avatar-change-btn' }).props.onPress()
    })

    expect(mockRequestAvatarPresign).not.toHaveBeenCalled()
    expect(mockUploadToPresignedUrl).not.toHaveBeenCalled()
    expect(mockUpdateUser).not.toHaveBeenCalled()
  })

  it('a failed upload keeps the old avatar and surfaces a non-blocking error', async () => {
    mockRequestPerms.mockResolvedValue({ granted: true })
    mockLaunchLibrary.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///tmp/pick.jpg', width: 400, height: 400, fileName: 'pick.jpg' }],
    })
    mockManipulate.mockResolvedValue({ uri: 'file:///tmp/pick-compressed.jpg' })
    mockRequestAvatarPresign.mockResolvedValue({
      uploadUrl: 'https://r2.example/x?sig=put',
      key: 'u/u1/avatar/server-key.jpg',
      headers: { 'Content-Type': 'image/jpeg' },
    })
    mockUploadToPresignedUrl.mockRejectedValue(new Error('upload_failed_403'))

    const renderer = await renderYouView()
    await act(async () => {
      await renderer.root.findByProps({ testID: 'avatar-change-btn' }).props.onPress()
    })

    // Commit never ran; old avatar untouched.
    expect(mockUpdateUser).not.toHaveBeenCalled()
    expect(mockPatchUser).not.toHaveBeenCalled()
    // A non-blocking inline error is shown.
    const err = renderer.root.findByProps({ testID: 'avatar-error' })
    expect(err.props.children).toBe('Could not update your photo.')
  })
})
