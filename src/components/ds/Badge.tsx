import type { HTMLAttributes } from "react";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  /** Color tone. */
  tone?: "default" | "yum" | "meh" | "nah" | "dark" | "pink";
}

/**
 * Badge — tiny pixel status pill.
 */
export function Badge({ tone = "default", className = "", children, ...rest }: BadgeProps) {
  const cls = [
    "yon-badge",
    tone !== "default" ? `yon-badge--${tone}` : "",
    className,
  ].filter(Boolean).join(" ");

  return (
    <span className={cls} {...rest}>
      {children}
    </span>
  );
}
