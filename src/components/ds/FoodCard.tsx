"use client";

import type { CSSProperties } from "react";
import type { Verdict } from "@/lib/types";
import { VerdictStamp } from "./VerdictStamp";
import { Badge } from "./Badge";

export interface FoodCardProps {
  /** Image URL. */
  image?: string;
  /** Food or drink name. */
  name?: string;
  /** Place/vendor name. */
  place?: string;
  /** Display price string, e.g. "$5.80". */
  price?: string;
  verdict?: Verdict;
  tags?: string[];
  /** How many times purchased. */
  boughtCount?: number;
  /** Override "Bought N×" text. */
  boughtLabel?: string;
  /** Override the verdict word on the stamp. */
  verdictLabel?: string;
  onClick?: () => void;
  className?: string;
  style?: CSSProperties;
}

/**
 * Normalise a tags array so that legacy entries whose value is a JSON-encoded
 * array string (e.g. '["Dessert"]') are exploded into individual tag strings.
 */
function normalizeTags(tags: string[]): string[] {
  const result: string[] = [];
  for (const t of tags) {
    const trimmed = t.trim();
    if (trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (typeof item === "string" && item.trim()) {
              result.push(item.trim());
            }
          }
          continue;
        }
      } catch {
        // fall through to use tag as-is
      }
    }
    if (trimmed) result.push(trimmed);
  }
  return result;
}

/**
 * FoodCard — a single logged taste: photo, name, place, price, verdict, tags.
 * Props are compatible with the Taste shape from @/lib/types.
 */
export function FoodCard({
  image,
  name,
  place,
  price,
  verdict = "yum",
  tags = [],
  boughtCount,
  boughtLabel,
  verdictLabel,
  onClick,
  className = "",
  style,
}: FoodCardProps) {
  const cls = [
    "yon-card",
    "yon-food",
    onClick ? "yon-card--interactive" : "",
    className,
  ].filter(Boolean).join(" ");

  const normalizedTags = normalizeTags(tags);

  return (
    <div className={cls} onClick={onClick} style={style}>
      <div className="yon-food__media">
        {image && <img src={image} alt={name} />}
        <VerdictStamp verdict={verdict} size="sm" label={verdictLabel} className="yon-food__stamp" />
      </div>
      <div className="yon-food__body">
        <div className="yon-food__row">
          <span className="yon-food__name">{name}</span>
          {price != null && <span className="yon-food__price">{price}</span>}
        </div>
        {place && <span className="yon-food__place">{place}</span>}
        {(normalizedTags.length > 0 || boughtCount) && (
          <div className="yon-food__meta">
            {boughtCount ? (
              <Badge tone="dark">{boughtLabel || `Bought ${boughtCount}×`}</Badge>
            ) : null}
            {normalizedTags.map((t) => <Badge key={t}>{t}</Badge>)}
          </div>
        )}
      </div>
    </div>
  );
}
