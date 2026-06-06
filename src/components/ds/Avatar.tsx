import type { HTMLAttributes, CSSProperties } from "react";

export interface AvatarProps extends HTMLAttributes<HTMLSpanElement> {
  /** Image URL. If absent, renders initials. */
  src?: string;
  /** Display name used for initials and alt text. */
  name?: string;
  /** Control size. */
  size?: "sm" | "md" | "lg";
  /** Fully round instead of squared. */
  circle?: boolean;
  style?: CSSProperties;
}

/**
 * Avatar — pixel-bordered profile chip. Shows an image or initials.
 */
export function Avatar({ src, name = "", size = "md", circle = false, className = "", style = {}, ...rest }: AvatarProps) {
  const cls = [
    "yon-avatar",
    `yon-avatar--${size}`,
    circle ? "yon-avatar--circle" : "",
    className,
  ].filter(Boolean).join(" ");

  const initials = name
    .split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();

  return (
    <span className={cls} style={style} {...rest}>
      {src ? <img src={src} alt={name} /> : (initials || "?")}
    </span>
  );
}
