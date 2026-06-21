/* ============================================================
   YUMMY OR NOT — LocationPickerProvider

   Owns the SINGLE, app-root location-picker map and exposes an imperative
   `open()` to any screen via `useLocationPicker()`.

   WHY a root-level singleton: react-native-amap3d crashes the whole app when
   its native MapView is UNMOUNTED (MapViewManager.onDropViewInstance →
   TextureMapView.onDestroy NPEs). A per-screen picker unmounted its map on every
   close → crash on ✕ / confirm / back-swipe. Here the map lives once at the root
   and is NEVER unmounted during normal use — opening/closing only toggles its
   visibility (the host hides it with display:none). So the only unmount is at
   app teardown, which the native teardown patch additionally guards.

   The context value is stable (`{ open }`), so opening/closing the picker never
   re-renders the app tree — only the host re-renders off the request state.
   ============================================================ */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

import type { LatLng } from '@/lib/locationPicker'
import LocationPickerHost from '@/components/app/LocationPickerHost'

type ConfirmFn = (coords: LatLng, place: string | null) => void

interface PickerRequest {
  initial: LatLng | null
  onConfirm: ConfirmFn
}

export interface LocationPickerContextValue {
  /** Open the app-root map picker, seeded at `initial` (WGS-84) or — when null —
   *  the GPS/fallback center. `onConfirm` fires once with the chosen WGS-84 pin
   *  and the reverse-geocoded address (or null). Cancelling fires nothing. */
  open: (initial: LatLng | null, onConfirm: ConfirmFn) => void
}

// Default to a no-op opener so screens that mount the hook outside a provider
// (e.g. in unit tests that don't exercise the picker) get a harmless stub rather
// than a throw. The real provider (mounted at the app root) supplies the opener.
const PickerContext = createContext<LocationPickerContextValue>({ open: () => {} })

export function useLocationPicker(): LocationPickerContextValue {
  return useContext(PickerContext)
}

export function LocationPickerProvider({ children }: { children: ReactNode }) {
  // `request != null` ⇒ the picker is open. `hasOpened` latches true on the first
  // open and never resets, so the host keeps the (consented) map mounted forever.
  const [request, setRequest] = useState<PickerRequest | null>(null)
  const [hasOpened, setHasOpened] = useState(false)
  const requestRef = useRef<PickerRequest | null>(null)

  const open = useCallback<LocationPickerContextValue['open']>((initial, onConfirm) => {
    const req: PickerRequest = { initial, onConfirm }
    requestRef.current = req
    setHasOpened(true)
    setRequest(req)
  }, [])

  const close = useCallback(() => {
    requestRef.current = null
    setRequest(null)
  }, [])

  const confirm = useCallback((coords: LatLng, place: string | null) => {
    const req = requestRef.current
    requestRef.current = null
    setRequest(null)
    req?.onConfirm(coords, place)
  }, [])

  // Stable identity → children never re-render when the picker toggles.
  const value = useMemo<LocationPickerContextValue>(() => ({ open }), [open])

  return (
    <PickerContext.Provider value={value}>
      {children}
      <LocationPickerHost
        visible={request != null}
        initial={request?.initial ?? null}
        keepMounted={hasOpened}
        onCancel={close}
        onConfirm={confirm}
      />
    </PickerContext.Provider>
  )
}
