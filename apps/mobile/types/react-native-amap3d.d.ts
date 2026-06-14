// Local ambient type shim for react-native-amap3d@3.2.4.
//
// WHY: the package ships RAW .tsx as its entry (lib/src, no .d.ts). Letting tsc
// follow that source pulls in its own type errors (TS7016 supercluster missing
// types, TS2416 Cluster.render, TS2322 map-view ref) that we cannot fix without
// patching node_modules. This shim declares ONLY the surface NearbyHeatView and
// amapPrivacy actually use, and tsconfig "paths" routes the module here so tsc
// resolves the shim instead of the package .tsx. Keep in sync with the real
// package if more exports are imported.
declare module 'react-native-amap3d' {
  import type * as React from 'react'
  import type { ViewProps, NativeSyntheticEvent } from 'react-native'

  export interface LatLng {
    latitude: number
    longitude: number
  }

  export interface LatLngBounds {
    southwest: LatLng
    northeast: LatLng
  }

  export interface CameraPosition {
    target?: LatLng
    zoom?: number
    bearing?: number
    tilt?: number
  }

  export interface CameraEvent {
    cameraPosition: CameraPosition
    latLngBounds: LatLngBounds
  }

  export interface MapViewProps extends ViewProps {
    initialCameraPosition?: CameraPosition
    myLocationEnabled?: boolean
    maxZoom?: number
    minZoom?: number
    onPress?: (event: NativeSyntheticEvent<LatLng>) => void
    onCameraMove?: (event: NativeSyntheticEvent<CameraEvent>) => void
    onCameraIdle?: (event: NativeSyntheticEvent<CameraEvent>) => void
    onLoad?: (event: NativeSyntheticEvent<void>) => void
  }

  export class MapView extends React.Component<MapViewProps> {
    moveCamera(cameraPosition: CameraPosition, duration?: number): void
  }

  export interface PolygonProps {
    points: LatLng[]
    strokeWidth?: number
    strokeColor?: string
    fillColor?: string
    zIndex?: number
  }

  export class Polygon extends React.Component<PolygonProps> {}

  export interface MarkerProps {
    position: LatLng
    zIndex?: number
    onPress?: (event: NativeSyntheticEvent<LatLng>) => void
    children?: React.ReactNode
  }

  export class Marker extends React.Component<MarkerProps> {}

  export namespace AMapSdk {
    function init(apiKey?: string): void
    function getVersion(): Promise<string>
  }
}
