"use client";

export interface SwitchProps {
  /** On/off state (controlled). */
  checked?: boolean;
  /** Called with the next boolean when toggled. */
  onChange?: (next: boolean) => void;
  disabled?: boolean;
  className?: string;
}

/** Pixel toggle switch; green when on. */
export function Switch({ checked = false, onChange, disabled = false, className = "", ...rest }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      className={["yon-switch", className].filter(Boolean).join(" ")}
      onClick={() => !disabled && onChange && onChange(!checked)}
      {...rest}
    >
      <span className="yon-switch__knob" />
    </button>
  );
}
