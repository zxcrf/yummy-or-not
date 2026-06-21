/* ============================================================
   YUMMY OR NOT — LocationPickerHost (non-Android stub)

   The AMap point-picker is Android-only (react-native-amap3d is a native Android
   SDK). On web / iOS / jest this stub stands in so LocationPickerProvider resolves
   without pulling the native map into the bundle. The "pick on map" entry point is
   gated on Platform.OS === 'android', so the picker is never opened here; this
   renders nothing if it ever is. Keep the props in sync with the .android host.
   ============================================================ */

import type { LatLng } from '@/lib/locationPicker'

export interface LocationPickerHostProps {
  visible: boolean
  initial: LatLng | null
  keepMounted: boolean
  onCancel: () => void
  onConfirm: (coords: LatLng, place: string | null) => void
}

export default function LocationPickerHost(_props: LocationPickerHostProps): null {
  return null
}
