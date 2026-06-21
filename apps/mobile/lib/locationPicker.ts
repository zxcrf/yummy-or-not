/* ============================================================
   YUMMY OR NOT — locationPicker (pure helpers for 定位选点)
   No RN components / no react-native-amap3d import here, so these run under
   jest-expo without mounting a native MapView (mirrors lib/heatView.ts for
   NearbyHeatView).

   The picker's whole correctness rests on ONE seam: the app stores pins in
   WGS-84, but AMap renders / reports its camera in GCJ-02. Get the conversion
   direction wrong and every China pin lands hundreds of metres off. These two
   functions own that seam so it can be unit-tested in isolation:

   - initialCameraFromPin(seed): WGS-84 pin → GCJ-02 camera (on the way IN).
   - pinFromCameraTarget(target): GCJ-02 camera center → WGS-84 pin (on the way
     OUT, read under the fixed center crosshair).
   ============================================================ */

import { gcj02ToWgs84, wgs84ToGcj02 } from '@yon/shared'

export interface LatLng {
  lat: number
  lng: number
}

/** AMap camera target shape (GCJ-02 device coords). */
export interface CameraTarget {
  latitude: number
  longitude: number
}

/** Default zoom the picker opens at — close enough to drop a precise pin. */
export const PICK_ZOOM = 16

/** Fallback center (Shanghai People's Square, WGS-84) when the taste has no pin
 *  yet and we have no GPS fix. Converted to GCJ-02 before it reaches AMap. */
export const PICKER_FALLBACK: LatLng = { lat: 31.2304, lng: 121.4737 }

/** Build the GCJ-02 initial camera from a WGS-84 seed pin. AMap is GCJ-02, the
 *  seed is WGS-84, so we ALWAYS convert — skipping it would offset a China
 *  pin by ~hundreds of metres. Outside China the transform is identity. */
export function initialCameraFromPin(seed: LatLng): { target: CameraTarget; zoom: number } {
  const g = wgs84ToGcj02(seed.lat, seed.lng)
  return { target: { latitude: g.lat, longitude: g.lng }, zoom: PICK_ZOOM }
}

/** Read the WGS-84 pin from the AMap camera center (GCJ-02), as reported by
 *  onCameraIdle under the fixed crosshair. Converts back to WGS-84 so the
 *  stored pin lines up with the rest of the app (createTaste / reverseGeocode
 *  all speak WGS-84). Outside China the transform is identity. */
export function pinFromCameraTarget(target: CameraTarget): LatLng {
  const w = gcj02ToWgs84(target.latitude, target.longitude)
  return { lat: w.lat, lng: w.lng }
}
