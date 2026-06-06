import type { InputHTMLAttributes } from "react";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Uppercase pixel label above the field. */
  label?: string;
  /** Helper text below the field. */
  hint?: string;
  /** Error message (replaces hint and turns the field red). */
  error?: string;
}

/**
 * Input — single-line text field with optional label and hint.
 */
export function Input({ label, hint, error, id, className = "", ...rest }: InputProps) {
  const inputId = id || (label ? `yon-${label.replace(/\s+/g, "-").toLowerCase()}` : undefined);
  const inputCls = ["yon-input", error ? "yon-input--error" : "", className].filter(Boolean).join(" ");

  return (
    <div className="yon-field">
      {label && <label className="yon-field__label" htmlFor={inputId}>{label}</label>}
      <input id={inputId} className={inputCls} {...rest} />
      {(hint || error) && (
        <span className={`yon-field__hint ${error ? "yon-field__hint--error" : ""}`}>
          {error || hint}
        </span>
      )}
    </div>
  );
}
