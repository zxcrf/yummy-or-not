/* ============================================================
   Unit tests — client-side active-taster module (app/(tabs)/_useActiveTaster).

   S3b: the active taster is a CLIENT selection state, persisted in the app
   (§S3b "active taster = 客户端选择态（持久化在 app）"). POST /api/tastes
   carries it; absent → the self-taster default.

   Pins:
   - Default active taster is null/self until one is chosen (self is the implicit
     default; no explicit selection needed for the owner's own records).
   - setActiveTaster persists the choice and every mounted view observes it.
   - The persisted key is namespaced per user (setActiveTasterUser) so switching
     accounts never leaks the previous account's active taster.
   - clearActiveTaster (logout) drops the persisted key and resets to self.

   AsyncStorage uses the official jest mock (jest.setup). Module-level state is
   reset between tests. This FAILS today: app/(tabs)/_useActiveTaster does not
   exist yet. PASSES once S3b ships the module.
   ============================================================ */

import TestRenderer, { act } from 'react-test-renderer'
import AsyncStorage from '@react-native-async-storage/async-storage'
import {
  useActiveTaster,
  setActiveTaster,
  setActiveTasterUser,
  clearActiveTaster,
} from '../_useActiveTaster'

const mountedRenderers: TestRenderer.ReactTestRenderer[] = []

afterEach(() => {
  act(() => { mountedRenderers.forEach((r) => r.unmount()) })
  mountedRenderers.length = 0
})

/** Mount a probe that records every active-taster value the hook yields. */
async function mountProbe() {
  const seen: (string | null)[] = []
  function Probe() {
    seen.push(useActiveTaster())
    return null
  }
  let renderer!: TestRenderer.ReactTestRenderer
  await act(async () => {
    renderer = TestRenderer.create(<Probe />)
  })
  mountedRenderers.push(renderer)
  return { seen }
}

const flush = () => act(async () => { await Promise.resolve() })

beforeEach(async () => {
  await act(async () => {
    setActiveTasterUser('__reset__')
    setActiveTasterUser(null)
  })
  await AsyncStorage.clear()
})

describe('useActiveTaster — default is self (null)', () => {
  it('starts null (self-taster default) when nothing was persisted', async () => {
    setActiveTasterUser('u1')
    const { seen } = await mountProbe()
    await flush()
    expect(seen[seen.length - 1]).toBeNull()
  })
})

describe('setActiveTaster — selection propagates and persists', () => {
  it('updates every mounted view and writes the choice to AsyncStorage', async () => {
    setActiveTasterUser('u1')
    const { seen } = await mountProbe()
    await flush()

    await act(async () => { await setActiveTaster('ts_partner') })
    await flush()

    expect(seen[seen.length - 1]).toBe('ts_partner')
    const raw = await AsyncStorage.getItem('yon_active_taster:u1')
    expect(raw).toBe('ts_partner')
  })

  it('rehydrates the persisted active taster on a cold mount', async () => {
    setActiveTasterUser('u1')
    await AsyncStorage.setItem('yon_active_taster:u1', 'ts_persisted')

    const { seen } = await mountProbe()
    await flush()
    await flush()

    expect(seen[seen.length - 1]).toBe('ts_persisted')
  })
})

describe('per-user namespacing', () => {
  it('scopes the active taster by account so switching users does not leak it', async () => {
    setActiveTasterUser('alice')
    await act(async () => { await setActiveTaster('alice_partner') })
    await flush()

    // Switch accounts — bob has no active taster yet → back to self (null).
    act(() => { setActiveTasterUser('bob') })
    const { seen } = await mountProbe()
    await flush()
    await flush()

    expect(seen[seen.length - 1]).toBeNull()
    expect(await AsyncStorage.getItem('yon_active_taster:alice')).toBe('alice_partner')
  })
})

describe('clearActiveTaster (logout cleanup)', () => {
  it('removes the persisted key and resets to self (null)', async () => {
    setActiveTasterUser('u1')
    await act(async () => { await setActiveTaster('ts_x') })
    await flush()
    expect(await AsyncStorage.getItem('yon_active_taster:u1')).toBe('ts_x')

    const { seen } = await mountProbe()
    await flush()

    await act(async () => { await clearActiveTaster() })
    await flush()

    expect(await AsyncStorage.getItem('yon_active_taster:u1')).toBeNull()
    expect(seen[seen.length - 1]).toBeNull()
  })
})
