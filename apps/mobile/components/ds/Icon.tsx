/* ============================================================
   YUMMY OR NOT — Icon (Tamagui / React Native)
   Pixel icons from pixelarticons (MIT). The web DS recolored local
   SVGs via CSS mask-image; on native there is no mask-image, so we
   render the same 24x24 path data through react-native-svg and tint
   it with the `color` prop on <Path fill>. The source SVGs are copied
   verbatim to apps/mobile/assets/ds-icons/ for parity / reference;
   the path strings used at runtime live in ./icon-paths.ts (generated
   from those same SVGs). Same `name` (kebab-case) prop API as the web
   Icon — see ICON_NAMES for the full set.
   ============================================================ */

import Svg, { Path } from 'react-native-svg'
import { ICON_PATHS, type IconName } from './icon-paths'

export { ICON_NAMES, type IconName } from './icon-paths'

export interface IconProps {
  /** Pixelarticons name in kebab-case, e.g. "heart", "camera". */
  name?: IconName | (string & {})
  /** Square size in px. Use multiples of 12 for crispest pixels. */
  size?: number
  /** Any color string; defaults to currentColor-equivalent ink. */
  color?: string
  /** Accessible label. Omit to mark the icon decorative. */
  label?: string
}

/**
 * Icon — pixel-art icon tinted via the SVG path fill. `name` is a
 * kebab-case pixelarticons name; unknown names render nothing.
 */
export function Icon({ name = 'heart', size = 20, color = '#191017', label }: IconProps) {
  const d = ICON_PATHS[name as IconName]
  if (!d) return null

  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      accessibilityRole="image"
      aria-label={label}
      accessibilityLabel={label}
    >
      <Path d={d} fill={color} />
    </Svg>
  )
}

export default Icon
