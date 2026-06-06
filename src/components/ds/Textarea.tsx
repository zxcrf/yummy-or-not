import type { TextareaHTMLAttributes } from "react";

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Uppercase pixel label above the field. */
  label?: string;
  /** Helper text below the field. */
  hint?: string;
  /** Error message (replaces hint and turns the field red). */
  error?: string;
}

/**
 * Textarea — multi-line text field with optional label and hint.
 */
export function Textarea({ label, hint, error, id, className = "", ...rest }: TextareaProps) {
  const taId = id || (label ? `yon-${label.replace(/\s+/g, "-").toLowerCase()}` : undefined);
  const taCls = ["yon-textarea", error ? "yon-textarea--error" : "", className].filter(Boolean).join(" ");

  return (
    <div className="yon-field">
      {label && <label className="yon-field__label" htmlFor={taId}>{label}</label>}
      <textarea id={taId} className={taCls} {...rest} />
      {(hint || error) && (
        <span className={`yon-field__hint ${error ? "yon-field__hint--error" : ""}`}>
          {error || hint}
        </span>
      )}
    </div>
  );
}
