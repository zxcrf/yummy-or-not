/* ============================================================
   YUMMY OR NOT — PageHeader (shared top bar)
   ONE top bar for every primary surface, with a CENTERED title and
   optional absolute left/right slots so the title stays centered no
   matter how wide the side controls are:
     • title — horizontally CENTERED (a string, or an interactive node
                such as Library's tasted/todo dropdown trigger).
     • left  — pinned top-left. Used by pushed management screens
                (标签管理 / 家人) for the unified 取消 control instead of a
                native back-arrow.
     • right — pinned top-right. The Library/Recall tabs put the
                TasterSwitcher avatar here; the avatar itself is how the
                user confirms which taster they're viewing (no separate
                "正在查看 X 的口味" banner).
     • safeAreaTop — pad the top by the safe-area inset. Tab screens leave
                this false (the Screen wrapper already insets); pushed
                screens that drop the native header set it true.
   ============================================================ */

import { type ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { colors, Text } from '@/theme'

interface PageHeaderProps {
  /** Centered title — a plain string or a custom interactive node. */
  title: ReactNode
  /** Pinned to the top-left corner (e.g. the 取消 control). */
  left?: ReactNode
  /** Pinned to the top-right corner (e.g. the taster avatar). */
  right?: ReactNode
  /** Pad the top by the safe-area inset (pushed screens without a native header). */
  safeAreaTop?: boolean
}

export function PageHeader({ title, left, right, safeAreaTop = false }: PageHeaderProps) {
  const insets = useSafeAreaInsets()
  return (
    <View style={[styles.outer, { paddingTop: (safeAreaTop ? insets.top : 0) + 4 }]}>
      <View style={styles.row}>
        {/* Centered title slot — box-none so taps fall through the full-width
            wrapper to the (interactive) title child without the wrapper itself
            swallowing touches meant for the side controls. */}
        <View style={styles.center} pointerEvents="box-none">
          {typeof title === 'string' ? <Text style={styles.title}>{title}</Text> : title}
        </View>
        {left != null && <View style={styles.left}>{left}</View>}
        {right != null && <View style={styles.right}>{right}</View>}
      </View>
    </View>
  )
}

export default PageHeader

const ROW_HEIGHT = 48

const styles = StyleSheet.create({
  outer: {
    backgroundColor: colors.background,
  },
  row: {
    minHeight: ROW_HEIGHT,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontWeight: '700',
    fontSize: 28,
  },
  left: {
    position: 'absolute',
    left: 16,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
  },
  right: {
    position: 'absolute',
    right: 16,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
  },
})
