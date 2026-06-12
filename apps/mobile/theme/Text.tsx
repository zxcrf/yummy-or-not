/* ============================================================
   YON — baseline-default Text wrapper (§1.1b).
   Applies textBase (color ink900, fontSize 16, lineHeight 23,
   fontWeight 400) then spreads caller style last so any explicit
   size/weight/spacing wins.

   Import `Text` from `@/theme` instead of `react-native` in every
   migrated screen and DS component. Only `Animated.Text` callsites
   use bare RN Text — they apply `textBase` inline.
   ============================================================ */

import React from 'react'
import { Text as RNText, type TextProps } from 'react-native'
import { textBase } from './type'

export { textBase }

const Text = ({ style, ...rest }: TextProps) => (
  <RNText style={[textBase, style]} {...rest} />
)

Text.displayName = 'YonText'

export default Text
export { Text }
