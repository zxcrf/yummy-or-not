/**
 * searchTastes — pure client-side search over a Taste array.
 *
 * Scoring tiers (higher = better match):
 *   exact   — normalized query equals a field value exactly
 *   strong  — query is a prefix of, or is fully contained in, a field value
 *   weak    — n-gram overlap (CJK 2-gram / latin word-token) above zero
 *
 * Field weights: name (3) > place (2) > notes (1).
 * Within a tier, higher field weight wins.
 *
 * Empty or single-character queries return [] so callers never show a noisy
 * full list when the user hasn't typed a real query yet.
 */

import type { Taste } from "./types";

/** Searchable fields on a Taste, in descending weight order. */
export type Field = "name" | "place" | "notes";

/** Opaque match strength — callers (e.g. same-name detection) can filter
 *  without caring about the raw numeric score. */
export type MatchStrength = "exact" | "strong" | "weak";

/** A single search result. */
export interface ScoredResult {
  item: Taste;
  score: number;
  matchedFields: Field[];
  /** Coarsest match tier among the matched fields for this item. */
  strength: MatchStrength;
}

// ---------------------------------------------------------------------------
// Score constants — tiers are spaced far apart so field weighting never lets
// a weaker tier beat a stronger one.
// ---------------------------------------------------------------------------
const TIER_EXACT = 10_000;
const TIER_STRONG = 1_000;
const TIER_WEAK = 1;

const FIELD_WEIGHT: Record<Field, number> = {
  name: 3,
  place: 2,
  notes: 1,
};

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

/**
 * Lowercase + collapse whitespace + strip ASCII punctuation.
 * CJK characters are intentionally preserved so 2-gram matching works.
 */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\s]+/g, " ")
    .replace(/[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/g, "")
    .trim();
}

// ---------------------------------------------------------------------------
// Token helpers
// ---------------------------------------------------------------------------

/** CJK Unicode block ranges (common subset covering Han, Hiragana, Katakana, Hangul). */
function isCJK(cp: number): boolean {
  return (
    (cp >= 0x4e00 && cp <= 0x9fff) || // CJK Unified Ideographs
    (cp >= 0x3040 && cp <= 0x30ff) || // Hiragana / Katakana
    (cp >= 0xac00 && cp <= 0xd7af) || // Hangul Syllables
    (cp >= 0x3400 && cp <= 0x4dbf) // CJK Extension A
  );
}

function hasCJK(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    if (isCJK(text.codePointAt(i)!)) return true;
  }
  return false;
}

/**
 * Tokenize text handling mixed scripts correctly.
 *
 * For a mixed query like "奶茶 latte":
 *   - The CJK run "奶茶" produces 2-grams: ["奶茶"]
 *   - The latin run "latte" produces word tokens: ["latte"]
 *   - Both sets are unioned so either script can match independently.
 *
 * Pure-CJK text → 2-grams only.
 * Pure-latin text → word tokens only.
 */
function tokenize(text: string): string[] {
  if (!hasCJK(text)) {
    // Fast path: no CJK — word tokens only.
    return text.split(/\s+/).filter(Boolean);
  }

  const tokens: string[] = [];

  // Walk the string and collect runs of each script type.
  let latinRun = "";
  for (let i = 0; i < text.length; i++) {
    const cp = text.codePointAt(i)!;
    if (isCJK(cp)) {
      // Flush any accumulated latin run.
      if (latinRun.trim()) {
        for (const w of latinRun.trim().split(/\s+/).filter(Boolean)) {
          tokens.push(w);
        }
        latinRun = "";
      }
      // Emit 2-grams for the CJK character and the next character (if CJK).
      if (i + 1 < text.length) {
        tokens.push(text.slice(i, i + 2));
      }
    } else {
      latinRun += text[i];
    }
  }
  // Flush any trailing latin run.
  if (latinRun.trim()) {
    for (const w of latinRun.trim().split(/\s+/).filter(Boolean)) {
      tokens.push(w);
    }
  }

  return tokens;
}

// ---------------------------------------------------------------------------
// Per-field scoring
// ---------------------------------------------------------------------------

function scoreField(query: string, fieldValue: string): number {
  const normField = normalizeText(fieldValue);
  if (!normField) return 0;

  // Exact match
  if (normField === query) return TIER_EXACT;

  // Prefix or substring (strong)
  if (normField.startsWith(query) || normField.includes(query)) return TIER_STRONG;

  // N-gram overlap (weak)
  const qTokens = tokenize(query);
  const fTokens = tokenize(normField);
  if (qTokens.length === 0 || fTokens.length === 0) return 0;

  const fSet = new Set(fTokens);
  const hits = qTokens.filter((t) => fSet.has(t)).length;
  if (hits === 0) return 0;

  // Score proportional to fraction of query tokens matched
  return TIER_WEAK * Math.round((hits / qTokens.length) * 100);
}

function tierFromScore(score: number): MatchStrength {
  if (score >= TIER_EXACT) return "exact";
  if (score >= TIER_STRONG) return "strong";
  return "weak";
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Score thresholds exported so callers can filter without knowing internals. */
export const SCORE_THRESHOLD: Record<MatchStrength, number> = {
  exact: TIER_EXACT,
  strong: TIER_STRONG,
  weak: TIER_WEAK,
};

/**
 * Search a list of tastes for a query string.
 *
 * Returns [] when query is empty or a single character (callers handle empty
 * states themselves).
 */
export function searchTastes(items: Taste[], query: string): ScoredResult[] {
  const normQuery = normalizeText(query);
  if (normQuery.length <= 1) return [];

  const results: ScoredResult[] = [];

  for (const item of items) {
    const fields: Field[] = ["name", "place", "notes"];
    let totalScore = 0;
    const matchedFields: Field[] = [];
    let bestStrength: MatchStrength = "weak";

    for (const field of fields) {
      const raw = item[field] ?? "";
      const fieldScore = scoreField(normQuery, raw);
      if (fieldScore > 0) {
        totalScore += fieldScore * FIELD_WEIGHT[field];
        matchedFields.push(field);
        const s = tierFromScore(fieldScore);
        // Upgrade to stronger tier if applicable
        if (
          s === "exact" ||
          (s === "strong" && bestStrength === "weak")
        ) {
          bestStrength = s;
        }
      }
    }

    if (totalScore > 0) {
      results.push({
        item,
        score: totalScore,
        matchedFields,
        strength: bestStrength,
      });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results;
}
