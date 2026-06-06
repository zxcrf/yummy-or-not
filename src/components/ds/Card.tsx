import type { HTMLAttributes } from "react";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Visual variant. */
  variant?: "raised" | "flat" | "soft";
  /** Add standard internal padding. */
  padded?: boolean;
  /** Show hover/press affordance. */
  interactive?: boolean;
}

/**
 * Card — the signature bordered + pop-shadow surface.
 */
export function Card({
  variant = "raised",
  padded = false,
  interactive = false,
  className = "",
  children,
  ...rest
}: CardProps) {
  const cls = [
    "yon-card",
    variant === "flat" ? "yon-card--flat" : "",
    variant === "soft" ? "yon-card--soft" : "",
    padded ? "yon-card--pad" : "",
    interactive ? "yon-card--interactive" : "",
    className,
  ].filter(Boolean).join(" ");

  return (
    <div className={cls} {...rest}>
      {children}
    </div>
  );
}
