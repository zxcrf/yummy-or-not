"use client";

import type { HTMLAttributes } from "react";
import type { Verdict } from "@/lib/types";

const OPTS: { key: Verdict; face: string; label: string }[] = [
  { key: "yum", face: "◕‿◕", label: "YUM" },
  { key: "meh", face: "•_•",  label: "MEH" },
  { key: "nah", face: "×_×",  label: "NAH" },
];

export interface VerdictPickerProps extends Omit<HTMLAttributes<HTMLDivElement>, "onChange"> {
  /** Currently selected verdict. */
  value?: Verdict | null;
  /** Called with the chosen verdict key. */
  onChange?: (verdict: Verdict) => void;
  /** Override the display labels. */
  labels?: { yum?: string; meh?: string; nah?: string };
}

/**
 * VerdictPicker — the core capture interaction. Tap yum / meh / nah.
 * Controlled via `value` + `onChange(key)`.
 */
export function VerdictPicker({ value, onChange, labels, className = "", ...rest }: VerdictPickerProps) {
  return (
    <div className={["yon-picker", className].filter(Boolean).join(" ")} role="radiogroup" {...rest}>
      {OPTS.map((o) => {
        const on = value === o.key;
        const cls = [
          "yon-picker__opt",
          `yon-picker__opt--${o.key}`,
          on ? "yon-picker__opt--on" : "",
        ].filter(Boolean).join(" ");

        return (
          <button
            key={o.key}
            type="button"
            role="radio"
            aria-checked={on}
            className={cls}
            onClick={() => onChange && onChange(o.key)}
          >
            <span className="yon-picker__face">{o.face}</span>
            {(labels && labels[o.key]) || o.label}
          </button>
        );
      })}
    </div>
  );
}
