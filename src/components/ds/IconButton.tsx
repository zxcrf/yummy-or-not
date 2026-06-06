"use client";

import type { ButtonHTMLAttributes } from "react";

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual style. */
  variant?: "secondary" | "pink" | "accent";
  /** Control size. */
  size?: "sm" | "md" | "lg";
  /** Fully rounded instead of squared. */
  round?: boolean;
}

/** A square/round button holding one Icon. */
export function IconButton({
  variant = "secondary",
  size = "md",
  round = false,
  className = "",
  children,
  ...rest
}: IconButtonProps) {
  const cls = [
    "yon-iconbtn",
    `yon-iconbtn--${size}`,
    variant === "pink" ? "yon-iconbtn--pink" : "",
    variant === "accent" ? "yon-iconbtn--accent" : "",
    round ? "yon-iconbtn--round" : "",
    className,
  ].filter(Boolean).join(" ");

  return (
    <button className={cls} {...rest}>
      {children}
    </button>
  );
}
