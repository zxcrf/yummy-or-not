// Design system barrel — import everything from "@/components/ds"
// Plain RN + Reanimated DS (no Tamagui). Exports all 14
// primitives and composites: 8 primitives owned here plus 6 composites
// authored alongside.

export { Icon, ICON_NAMES } from './Icon'
export type { IconProps, IconName } from './Icon'

export { Button } from './Button'
export type { ButtonProps } from './Button'

export { IconButton } from './IconButton'
export type { IconButtonProps } from './IconButton'

export { Input } from './Input'
export type { InputProps } from './Input'

export { Textarea } from './Textarea'
export type { TextareaProps } from './Textarea'

export { Switch } from './Switch'
export type { SwitchProps } from './Switch'

export { Card } from './Card'
export type { CardProps } from './Card'

export { Badge } from './Badge'
export type { BadgeProps } from './Badge'

export { Tag } from './Tag'
export type { TagProps } from './Tag'

export { Avatar } from './Avatar'
export type { AvatarProps } from './Avatar'

export { VerdictStamp } from './VerdictStamp'
export type { VerdictStampProps } from './VerdictStamp'

export { VerdictPicker } from './VerdictPicker'
export type { VerdictPickerProps } from './VerdictPicker'

export { FoodCard } from './FoodCard'
export type { FoodCardProps } from './FoodCard'

export { LangSwitcher } from './LangSwitcher'
export type { LangSwitcherProps, LangEntry } from './LangSwitcher'
