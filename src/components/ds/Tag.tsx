"use client";

import type { HTMLAttributes, ButtonHTMLAttributes } from "react";

export interface TagProps extends HTMLAttributes<HTMLButtonElement | HTMLSpanElement> {
  /** Highlighted (selected filter) state. */
  active?: boolean;
  /** Called when the × is clicked. Renders a remove affordance. */
  onRemove?: () => void;
  onClick?: () => void;
}

/**
 * Tag — rounded chip. Clickable (filter) and/or removable.
 */
export function Tag({ active = false, onRemove, onClick, className = "", children, ...rest }: TagProps) {
  const clickable = !!onClick;
  const cls = [
    "yon-tag",
    active ? "yon-tag--active" : "",
    clickable ? "yon-tag--clickable" : "",
    className,
  ].filter(Boolean).join(" ");

  if (clickable) {
    return (
      <button className={cls} onClick={onClick} {...(rest as ButtonHTMLAttributes<HTMLButtonElement>)}>
        {children}
        {onRemove && (
          <span
            className="yon-tag__x"
            role="button"
            aria-label="Remove"
            onClick={(e) => { e.stopPropagation(); onRemove(); }}
          >
            ×
          </span>
        )}
      </button>
    );
  }

  return (
    <span className={cls} {...(rest as HTMLAttributes<HTMLSpanElement>)}>
      {children}
      {onRemove && (
        <span
          className="yon-tag__x"
          role="button"
          aria-label="Remove"
          onClick={(e) => { e.stopPropagation(); onRemove!(); }}
        >
          ×
        </span>
      )}
    </span>
  );
}
