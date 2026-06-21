/* ============================================================
   YUMMY OR NOT — LocationPicker (non-Android stub)

   The AMap point-picker is Android-only (react-native-amap3d is a native
   Android SDK). On web / iOS / jest this stub stands in so the module resolves
   without pulling the native map into the bundle. Callers gate the "pick on
   map" entry point on Platform.OS === 'android', so this never actually opens;
   it renders nothing if it ever does. Keep the prop types in sync with
   LocationPicker.android.tsx.
   ============================================================ */

export interface LatLngLiteral {
  lat: number
  lng: number
}

export interface LocationPickerProps {
  visible: boolean
  initial: LatLngLiteral | null
  onCancel: () => void
  onConfirm: (coords: LatLngLiteral, place: string | null) => void
}

export default function LocationPicker(_props: LocationPickerProps): null {
  return null
}
