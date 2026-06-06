// Pixel icons from pixelarticons (MIT). In Next.js we reference local SVGs
// via CSS mask-image so they recolor via the `color` prop and work at any path.
// The SVGs live in public/ds-icons/<name>.svg.

import type { HTMLAttributes, CSSProperties } from "react";

export const ICON_NAMES = [
  "alert", "arrow-down", "arrow-left", "arrow-right", "arrow-up",
  "bookmark", "calendar", "camera", "cart", "cellular-signal-0",
  "chart-bar", "check", "chevron-down", "chevron-left", "chevron-right",
  "chevron-up", "clock", "close", "coin", "credit-card",
  "dollar", "download", "drop-area", "edit", "eye", "eye-closed",
  "flag", "folder", "grid", "heart", "home", "image", "image-multiple",
  "info-box", "label", "list", "lock", "mail", "map", "minus",
  "more-horizontal", "more-vertical", "pin", "plus", "reciept",
  "search", "sliders", "sort", "trash", "trending-up", "upload",
  "user", "users", "zap",
] as const;

export type IconName = (typeof ICON_NAMES)[number];

export interface IconProps extends HTMLAttributes<HTMLSpanElement> {
  /** Pixelarticons name in kebab-case, e.g. "heart", "camera". */
  name?: string;
  /** Square size in px. Use multiples of 12 for crispest pixels. */
  size?: number;
  /** Any CSS color; defaults to currentColor so it inherits text color. */
  color?: string;
  /** Accessible label. Omit to mark the icon decorative (aria-hidden). */
  label?: string;
  style?: CSSProperties;
}

/**
 * Icon — pixel-art icon tinted with brand colors via CSS mask-image.
 * `name` is a kebab-case pixelarticons name; see ICON_NAMES for the full set.
 */
export function Icon({
  name = "heart",
  size = 20,
  color = "currentColor",
  label,
  style = {},
  ...rest
}: IconProps) {
  const maskStyle: CSSProperties = {
    backgroundColor: color,
    WebkitMaskImage: `url(/ds-icons/${name}.svg)`,
    maskImage: `url(/ds-icons/${name}.svg)`,
    WebkitMaskRepeat: "no-repeat",
    maskRepeat: "no-repeat",
    WebkitMaskSize: "contain",
    maskSize: "contain",
    WebkitMaskPosition: "center",
    maskPosition: "center",
  };

  return (
    <span
      role="img"
      aria-label={label || undefined}
      aria-hidden={label ? undefined : true}
      style={{ display: "inline-block", width: size, height: size, flex: "none", ...maskStyle, ...style }}
      {...rest}
    />
  );
}
