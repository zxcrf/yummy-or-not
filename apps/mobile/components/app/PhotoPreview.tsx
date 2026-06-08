/* ============================================================
   YUMMY OR NOT — PhotoPreview (React Native)
   Renders the selected/captured photo inside the AddModal dropzone.

   This MUST use react-native's <Image> (not a raw HTML <img>).
   On native builds a raw <img> crashes the whole screen with
   "View config getter callback for component `img` must be a
   function (received `undefined`)" the moment a photo is chosen
   and the preview becomes visible. Image works on both native and
   web (react-native-web), so no platform branch is needed.
   ============================================================ */

import { Image } from 'react-native'

interface PhotoPreviewProps {
  /** Local/remote image uri of the picked or captured photo. */
  uri: string
}

export function PhotoPreview({ uri }: PhotoPreviewProps) {
  return (
    <Image
      source={{ uri }}
      style={{ width: '100%', height: '100%' }}
      resizeMode="cover"
      accessibilityRole="image"
    />
  )
}
