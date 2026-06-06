"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual style. */
  variant?: "primary" | "secondary" | "accent" | "dark" | "ghost";
  /** Control size. */
  size?: "sm" | "md" | "lg";
  /** Stretch to full width. */
  block?: boolean;
  /** Element rendered before the label (e.g. an <Icon/>). */
  iconLeft?: ReactNode;
  /** Element rendered after the label. */
  iconRight?: ReactNode;
}

/**
 * Button — the primary action control. Chunky border + pop shadow that
 * presses into the page on :active.
 */
export function Button({
  variant = "primary",
  size = "md",
  block = false,
  iconLeft,
  iconRight,
  className = "",
  children,
  ...rest
}: ButtonProps) {
  const cls = [
    "yon-btn",
    `yon-btn--${variant}`,
    `yon-btn--${size}`,
    block ? "yon-btn--block" : "",
    className,
  ].filter(Boolean).join(" ");

  return (
    <button className={cls} {...rest}>
      {iconLeft}
      {children}
      {iconRight}
    </button>
  );
}
