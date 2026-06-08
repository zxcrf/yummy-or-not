/* ============================================================
   YUMMY OR NOT — Tag (Tamagui / React Native)
   Rounded pixel chip. Clickable (filter) and/or removable. Ported from
   the web DS: a pill with a chunky ink border; the active (selected
   filter) state fills brand-pink; an optional × removes it.
   ============================================================ */

import { type GetProps, View, styled, Text } from 'tamagui'

const Chip = styled(View, {
  name: 'Tag',
  flexDirection: 'row',
  alignItems: 'center',
  alignSelf: 'flex-start',
  gap: 6,
  paddingHorizontal: '$3',
  paddingVertical: '$1',
  borderWidth: 2,
  borderColor: '$ink900',
  borderRadius: '$pill',
  backgroundColor: '$paper2',

  variants: {
    active: {
      true: { backgroundColor: '$brand', borderColor: '$ink900' },
    },
    clickable: {
      true: { cursor: 'pointer' },
    },
  } as const,
})

export type TagProps = Omit<GetProps<typeof Chip>, 'children'> & {
  /** Highlighted (selected filter) state. */
  active?: boolean
  /** Called when the × is pressed. Renders a remove affordance. */
  onRemove?: () => void
  onPress?: () => void
  children?: React.ReactNode
}

/**
 * Tag — rounded chip. Clickable (filter) and/or removable.
 */
export function Tag({ active = false, onRemove, onPress, children, ...rest }: TagProps) {
  const clickable = !!onPress

  return (
    <Chip
      active={active}
      clickable={clickable}
      onPress={onPress}
      accessibilityRole={clickable ? 'button' : undefined}
      {...rest}
    >
      <Text
        color={active ? '$onBrand' : '$ink900'}
        fontWeight="600"
        fontSize={13}
        lineHeight={17}
      >
        {children}
      </Text>
      {onRemove ? (
        <Text
          accessibilityRole="button"
          aria-label="Remove"
          onPress={(e) => {
            e.stopPropagation?.()
            onRemove()
          }}
          color={active ? '$onBrand' : '$ink900'}
          fontWeight="700"
          fontSize={14}
          lineHeight={17}
        >
          ×
        </Text>
      ) : null}
    </Chip>
  )
}

export default Tag
