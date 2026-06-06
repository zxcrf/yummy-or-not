import type { HTMLAttributes, CSSProperties } from "react";
import type { Verdict } from "@/lib/types";

const FACES: Record<Verdict, string> = { yum: "◕‿◕", meh: "•_•", nah: "×_×" };
const LABELS: Record<Verdict, string> = { yum: "YUM", meh: "MEH", nah: "NAH" };

export interface VerdictStampProps extends HTMLAttributes<HTMLSpanElement> {
  verdict?: Verdict;
  size?: "sm" | "md" | "lg";
  /** Override the verdict word text. */
  label?: string;
  /** Rotation in degrees; 0 = upright. */
  rotate?: number;
  showFace?: boolean;
  style?: CSSProperties;
}

/**
 * VerdictStamp — the slap-on verdict label (yum / meh / nah).
 */
export function VerdictStamp({
  verdict = "yum",
  size = "md",
  showFace = true,
  rotate = 0,
  label,
  className = "",
  style = {},
  ...rest
}: VerdictStampProps) {
  const cls = ["yon-stamp", `yon-stamp--${size}`, `yon-stamp--${verdict}`, className].filter(Boolean).join(" ");

  return (
    <span
      className={cls}
      style={{ transform: rotate ? `rotate(${rotate}deg)` : undefined, ...style }}
      {...rest}
    >
      {showFace && <span className="yon-stamp__face">{FACES[verdict]}</span>}
      {label || LABELS[verdict]}
    </span>
  );
}
