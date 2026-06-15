/* ============================================================
   S3b Phase 2 — VideoPlayerModal (D3 / D4).

   Behavior under test:
   - Mounts a VideoView fed the initial clipUrl via useVideoPlayer(clipUrl).
   - ⟦D1⟧ On a playback 'error' status, the player re-fetches a FRESH taste
     (getTaste(id)) ONCE and swaps in the fresh clipUrl (covers pause-past-TTL).
   - A SECOND error does NOT re-fetch again (retry-once) and surfaces the
     inline error message.

   Mount uses `await act(async () => …)` + afterEach unmount per
   docs/engineering/jest-async-leaks.md so the getTaste promise continuation is
   drained inside act (act-warning grep gate stays at baseline).
   ============================================================ */

import TestRenderer, { act } from 'react-test-renderer'

// ---- inline expo-video mock: capture the statusChange listener so a test can
//      drive an 'error' status, and expose the player + source for assertions.
let lastPlayer: { __emit: (e: string, p: unknown) => void } | null = null
let lastSource: string | null = null
jest.mock('expo-video', () => {
  const React = require('react')
  return {
    useVideoPlayer: (source: string, setup?: (p: unknown) => void) => {
      lastSource = source
      const listeners: Record<string, (p: unknown) => void> = {}
      const player = {
        play: jest.fn(),
        release: jest.fn(),
        status: 'idle',
        addListener: (event: string, cb: (p: unknown) => void) => {
          listeners[event] = cb
          return { remove: jest.fn() }
        },
        __emit: (event: string, payload: unknown) => listeners[event]?.(payload),
      }
      if (setup) setup(player)
      lastPlayer = player
      return player
    },
    VideoView: (props: Record<string, unknown>) =>
      React.createElement('VideoView', props, null),
  }
})

const mockGetTaste = jest.fn()
jest.mock('@yon/shared', () => ({
  getTaste: (...args: unknown[]) => mockGetTaste(...args),
}))

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 47, bottom: 0, left: 0, right: 0 }),
}))

jest.mock('@/providers/I18nProvider', () => ({
  useI18n: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        cancel: 'Close',
        video_load_failed: "Couldn't play this video. Please try again later.",
      }
      return map[key] ?? key
    },
  }),
}))

jest.mock('@/components/ds', () => {
  const React = require('react')
  return {
    Icon: ({ name }: { name: string }) => React.createElement('span', { 'data-icon': name }),
    IconButton: ({ children, onPress }: { children: React.ReactNode; onPress?: () => void }) =>
      React.createElement('button', { onClick: onPress }, children),
  }
})

import { VideoPlayerModal } from '../VideoPlayerModal'

const mountedRenderers: TestRenderer.ReactTestRenderer[] = []

async function renderPlayer(clipUrl: string) {
  const onClose = jest.fn()
  let renderer!: TestRenderer.ReactTestRenderer
  await act(async () => {
    renderer = TestRenderer.create(
      <VideoPlayerModal tasteId="t1" clipUrl={clipUrl} onClose={onClose} />,
    )
  })
  mountedRenderers.push(renderer)
  return { renderer, onClose }
}

afterEach(() => {
  act(() => {
    mountedRenderers.forEach((r) => r.unmount())
  })
  mountedRenderers.length = 0
  lastPlayer = null
  lastSource = null
  jest.clearAllMocks()
})

describe('VideoPlayerModal (D3)', () => {
  it('mounts a VideoView fed the initial clipUrl', async () => {
    const { renderer } = await renderPlayer('https://r2.example/clip?sig=initial')
    const view = renderer.root.findByType('VideoView' as unknown as React.ComponentType)
    // The player passed to VideoView is the one created from clipUrl.
    expect(view.props.player).toBe(lastPlayer)
    expect(lastSource).toBe('https://r2.example/clip?sig=initial')
  })

  it('on a playback error re-fetches a fresh taste once and swaps the clipUrl', async () => {
    mockGetTaste.mockResolvedValue({ id: 't1', clipUrl: 'https://r2.example/clip?sig=fresh' })
    await renderPlayer('https://r2.example/clip?sig=stale')

    // Drive a playback error → triggers the one-shot presign refresh.
    await act(async () => {
      lastPlayer?.__emit('statusChange', { status: 'error' })
      await Promise.resolve()
    })

    expect(mockGetTaste).toHaveBeenCalledTimes(1)
    expect(mockGetTaste).toHaveBeenCalledWith('t1')
    // The player was re-created from the fresh URL.
    expect(lastSource).toBe('https://r2.example/clip?sig=fresh')
  })

  it('a second error does NOT refresh again and shows the inline error', async () => {
    mockGetTaste.mockResolvedValue({ id: 't1', clipUrl: 'https://r2.example/clip?sig=fresh' })
    const { renderer } = await renderPlayer('https://r2.example/clip?sig=stale')

    // First error → one refresh.
    await act(async () => {
      lastPlayer?.__emit('statusChange', { status: 'error' })
      await Promise.resolve()
    })
    // Second error (the fresh URL also failed) → no further refresh, error shown.
    await act(async () => {
      lastPlayer?.__emit('statusChange', { status: 'error' })
      await Promise.resolve()
    })

    expect(mockGetTaste).toHaveBeenCalledTimes(1)
    const errorNode = renderer.root.findAll((n) => n.props.testID === 'video-player-error')
    expect(errorNode.length).toBeGreaterThan(0)
  })
})
