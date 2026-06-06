"use client";

import { useState, useRef, useEffect, type HTMLAttributes } from "react";
import { Icon } from "./Icon";

export interface LangEntry {
  code: string;
  label: string;
  native: string;
}

export interface LangSwitcherProps extends Omit<HTMLAttributes<HTMLDivElement>, "onChange"> {
  /** Currently selected language code. */
  value?: string;
  /** Called with the chosen language code. */
  onChange?: (code: string) => void;
  /** Available languages. */
  languages?: LangEntry[];
  /** Dropdown alignment. */
  align?: "left" | "right";
  /** Background color of the trigger pill. */
  tone?: string;
}

/**
 * LangSwitcher — prominent, on-brand language picker. Controlled via
 * `value` + `onChange(code)`. Shows the current language as a candy pill
 * and opens a dropdown of options.
 */
export function LangSwitcher({
  value,
  onChange,
  languages = [],
  align = "left",
  tone = "var(--candy-blue)",
  className = "",
  ...rest
}: LangSwitcherProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = languages.find((l) => l.code === value) || languages[0] || { native: "—", label: "" };

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div
      ref={ref}
      className={["yon-lang", className].filter(Boolean).join(" ")}
      style={{ position: "relative", display: "inline-block" }}
      {...rest}
    >
      <button
        type="button"
        className="yon-lang__btn"
        style={{ background: tone }}
        onClick={() => setOpen(!open)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <Icon name="flag" size={15} color="#fff" />
        <span className="yon-lang__label">{current.native}</span>
        <Icon name={open ? "chevron-up" : "chevron-down"} size={14} color="#fff" />
      </button>

      {open && (
        <div
          className="yon-lang__menu"
          style={align === "right" ? { right: 0 } : { left: 0 }}
          role="listbox"
        >
          {languages.map((l) => {
            const on = l.code === value;
            return (
              <button
                key={l.code}
                type="button"
                role="option"
                aria-selected={on}
                className={["yon-lang__opt", on ? "yon-lang__opt--on" : ""].filter(Boolean).join(" ")}
                onClick={() => { if (onChange) onChange(l.code); setOpen(false); }}
              >
                <span className="yon-lang__native">{l.native}</span>
                <span className="yon-lang__en">{l.label}</span>
                {on && <Icon name="check" size={16} color="var(--verdict-yum-2)" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
