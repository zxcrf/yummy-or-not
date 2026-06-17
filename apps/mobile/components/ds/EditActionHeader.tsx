/* ============================================================
   YUMMY OR NOT — EditActionHeader (plain RN + theme)

   ONE unified 3-slot action bar used by every editable/command
   screen so save/cancel always live in the same place:
     取消 (cancel) LEFT · title CENTER · primary command RIGHT.

   The title is an absolute, pointerEvents-none layer so it stays
   visually centered regardless of unequal left/right widths and
   never eats taps on the side buttons. See ADR 0001.
   ============================================================ */

import { ActivityIndicator, Pressable, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { colors, space, Text } from '@/theme'
import { Button } from './Button'
import { Icon } from './Icon'
import type { IconName } from './Icon'

// ---------- Public types ----------

export type EditActionHeaderProps = {
  testID?: string
  /** Fired when the left cancel control is pressed. */
  onCancel: () => void
  /** Label for the left cancel control — caller passes t('cancel'). */
  cancelLabel: string
  cancelTestID?: string
  /** Centered title. */
  title: string
  /** Fired when the right primary command is pressed. */
  onPrimary: () => void
  /** Label for the right primary command — varies: save / 查找 / import. */
  primaryLabel: string
  primaryDisabled?: boolean
  /** Show an <ActivityIndicator> in place of the primary label. */
  primaryLoading?: boolean
  /** Callers MUST be able to keep their existing primary testID. */
  primaryTestID?: string
  /** Icon shown before the primary label. Pass null to omit. Default 'check'. */
  primaryIcon?: IconName | null
}

// ---------- Component ----------

export function EditActionHeader({
  testID,
  onCancel,
  cancelLabel,
  cancelTestID,
  title,
  onPrimary,
  primaryLabel,
  primaryDisabled,
  primaryLoading,
  primaryTestID,
  primaryIcon = 'check',
}: EditActionHeaderProps) {
  const insets = useSafeAreaInsets()

  const padTop = insets.top + 12
  const padBottom = 12

  const showIcon = !primaryLoading && primaryIcon != null

  return (
    <View
      testID={testID}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: space[5],
        backgroundColor: colors.background,
        paddingTop: padTop,
        paddingBottom: padBottom,
        borderBottomWidth: 3,
        borderBottomColor: colors.ink900,
      }}
    >
      {/* Absolutely-centered title layer. pointerEvents none so it never
          eats taps on the side buttons; left/right gutters keep it clear
          of the cancel/primary controls. top/bottom match the padded
          content box so the title sits on the cancel/保存 centerline. */}
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: 64,
          right: 64,
          top: padTop,
          bottom: padBottom,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text
          numberOfLines={1}
          style={{ fontSize: 17, fontWeight: '700', color: colors.ink900 }}
        >
          {title}
        </Text>
      </View>

      {/* Left slot — cancel */}
      <Pressable
        onPress={onCancel}
        testID={cancelTestID}
        hitSlop={8}
        accessibilityRole="button"
      >
        <Text style={{ fontSize: 16, color: colors.ink900 }}>{cancelLabel}</Text>
      </Pressable>

      {/* Right slot — primary command */}
      <Button
        variant="primary"
        size="sm"
        disabled={primaryDisabled}
        onPress={onPrimary}
        testID={primaryTestID}
        iconLeft={showIcon ? <Icon name={primaryIcon} size={16} color="#fff" /> : undefined}
      >
        {primaryLoading ? <ActivityIndicator color="#fff" /> : primaryLabel}
      </Button>
    </View>
  )
}

export default EditActionHeader
