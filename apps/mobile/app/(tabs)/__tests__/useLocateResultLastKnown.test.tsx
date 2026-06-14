/* ============================================================
   RED regression — Bug 1: 附近·热力 定位失败 falls back to 默认城市 on
   cold GPS.

   User feedback: entering 附近·热力 on a fresh / cold-GPS device shows the
   default city (Shanghai) instead of the user's real position.

   Root cause (apps/mobile/app/(tabs)/_useUserCoords.ts:112-131):
   `useLocateResult` acquires a fix ONLY via getCurrentPositionAsync raced
   against a 10s timeout. On a cold GPS that single call times out → the
   catch sets status='failed' → NearbyHeatView centers on the FALLBACK city.

   The fix ports the AddModal pattern: try getLastKnownPositionAsync first
   (an instant cached fix) and only fail when BOTH sources come up empty.

   These tests pin that behavior:
   - getCurrentPositionAsync rejects (cold GPS) BUT getLastKnownPositionAsync
     returns a cached fix → status is NOT 'failed', the cached coords are
     used (NO Shanghai fallback).
   - both sources empty → status IS 'failed'.

   Against the CURRENT code the first/second tests FAIL: getLastKnownPositionAsync
   is never called, so a rejected getCurrentPositionAsync always flips status to
   'failed' (coords null → fallback city).
   ============================================================ */

import TestRenderer, { act } from 'react-test-renderer'
import { useLocateResult, type LocateResult } from '../_useUserCoords'

const mockRequestPerm = jest.fn()
const mockGetPosition = jest.fn()
const mockGetLastKnown = jest.fn()

jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: (...args: unknown[]) => mockRequestPerm(...args),
  getCurrentPositionAsync: (...args: unknown[]) => mockGetPosition(...args),
  getLastKnownPositionAsync: (...args: unknown[]) => mockGetLastKnown(...args),
  Accuracy: { Balanced: 3 },
}))

function Harness({ onValue }: { onValue: (v: LocateResult) => void }) {
  const result = useLocateResult(true)
  onValue(result)
  return null
}

describe('useLocateResult — last-known fallback on cold GPS (Bug 1)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockRequestPerm.mockResolvedValue({ granted: true })
  })

  it('uses cached last-known coords (status NOT failed) when getCurrentPositionAsync times out on cold GPS', async () => {
    // Cold GPS: the live fix never resolves (simulate the 10s-timeout reject),
    // but the OS still has a recent cached position.
    mockGetPosition.mockRejectedValue(new Error('timeout'))
    mockGetLastKnown.mockResolvedValue({
      coords: { latitude: 39.9042, longitude: 116.4074 }, // Beijing — NOT Shanghai
    })

    let latest: LocateResult = { coords: null, status: 'locating' }
    await act(async () => {
      TestRenderer.create(<Harness onValue={(v) => { latest = v }} />)
    })

    // The regression: old code flips to 'failed' the moment getCurrentPositionAsync
    // rejects (it never consults the cached fix), and NearbyHeatView then centers
    // on the Shanghai FALLBACK. With the last-known fallback this must NOT happen.
    expect(latest.status).not.toBe('failed')
    expect(latest.status).toBe('ready')
    expect(latest.coords).toEqual({ lat: 39.9042, lng: 116.4074 })
  })

  it('still surfaces status=failed only when BOTH position sources come up empty', async () => {
    mockGetPosition.mockRejectedValue(new Error('timeout'))
    mockGetLastKnown.mockResolvedValue(null)

    let latest: LocateResult = { coords: null, status: 'locating' }
    await act(async () => {
      TestRenderer.create(<Harness onValue={(v) => { latest = v }} />)
    })

    expect(latest.status).toBe('failed')
    expect(latest.coords).toBeNull()
  })
})
