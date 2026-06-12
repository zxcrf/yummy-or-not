/**
 * Tests for searchTastes.
 *
 * Coverage checklist:
 *  - CJK query (Chinese 2-gram matching)
 *  - Latin query (word-token matching)
 *  - Mixed CJK + latin query
 *  - Tier ordering: exact beats contains beats n-gram overlap
 *  - Field weighting: name hit outranks notes hit when both are same tier
 *  - Notes-content hit IS returned (regression — old LibraryView only searched name/place)
 *  - Normalization: case, punctuation
 *  - Empty query returns []
 *  - Single-character query returns results (not empty)
 */

import { searchTastes, normalizeText, SCORE_THRESHOLD } from "../search";
import type { Taste } from "../types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let idSeq = 0;
function taste(overrides: Partial<Taste> & { name: string }): Taste {
  return {
    id: String(++idSeq),
    place: "",
    price: "",
    verdict: "yum",
    tags: [],
    boughtCount: 0,
    date: "just now",
    notes: "",
    image: "",
    imageThumb: "",
    imageDisplay: "",
    imageKey: "",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// normalizeText
// ---------------------------------------------------------------------------

describe("normalizeText", () => {
  it("lowercases", () => {
    expect(normalizeText("Latte")).toBe("latte");
  });

  it("strips ASCII punctuation", () => {
    expect(normalizeText("taco's! (best)")).toBe("tacos best");
  });

  it("collapses whitespace", () => {
    expect(normalizeText("  ramen   noodles  ")).toBe("ramen noodles");
  });

  it("preserves CJK characters", () => {
    expect(normalizeText("拉面")).toBe("拉面");
  });

  it("preserves CJK mixed with latin", () => {
    expect(normalizeText("Boba 珍珠奶茶")).toBe("boba 珍珠奶茶");
  });
});

// ---------------------------------------------------------------------------
// Empty / too-short queries
// ---------------------------------------------------------------------------

describe("empty / short query guard", () => {
  const items = [taste({ name: "Latte" })];

  it("returns [] for empty string", () => {
    expect(searchTastes(items, "")).toHaveLength(0);
  });

  it("returns results for single latin character", () => {
    const item = taste({ name: "Latte" });
    const results = searchTastes([item], "L");
    expect(results).toHaveLength(1);
    expect(results[0].item).toBe(item);
  });

  it("returns results for single CJK character", () => {
    const item = taste({ name: "拉面" });
    const results = searchTastes([item], "拉");
    expect(results).toHaveLength(1);
    expect(results[0].item).toBe(item);
  });

  it("returns results for two-character query", () => {
    expect(searchTastes(items, "La")).not.toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Latin query — basic matching
// ---------------------------------------------------------------------------

describe("latin query", () => {
  const latte = taste({ name: "Caramel Latte", place: "Starbucks" });
  const ramen = taste({ name: "Tonkotsu Ramen", place: "Ichiran" });
  const items = [latte, ramen];

  it("finds an exact name match", () => {
    const results = searchTastes([taste({ name: "latte" })], "latte");
    expect(results).toHaveLength(1);
    expect(results[0].strength).toBe("exact");
  });

  it("finds a partial name match", () => {
    const results = searchTastes(items, "latte");
    expect(results.some((r) => r.item === latte)).toBe(true);
  });

  it("does not include items with no match", () => {
    const results = searchTastes(items, "burger");
    expect(results).toHaveLength(0);
  });

  it("returns matchedFields correctly for name hit", () => {
    const results = searchTastes([latte], "latte");
    expect(results[0].matchedFields).toContain("name");
  });
});

// ---------------------------------------------------------------------------
// Tier ordering: exact > contains > n-gram
// ---------------------------------------------------------------------------

describe("tier ordering", () => {
  const exactMatch = taste({ name: "latte" });
  const prefixMatch = taste({ name: "latte macchiato" });
  const ngramMatch = taste({ name: "macchiato with oat milk la" }); // shares 'la' token — very weak

  it("exact beats contains when both match the query", () => {
    const results = searchTastes([prefixMatch, exactMatch], "latte");
    expect(results[0].item).toBe(exactMatch);
    expect(results[0].strength).toBe("exact");
    expect(results[1].strength).toBe("strong");
  });

  it("strong tier beats weak tier in final ranking", () => {
    // strongItem: "latte" is a substring of the name → STRONG tier.
    const strongItem = taste({ name: "caramel latte" });
    // weakItem: name is "milk foam" — does NOT contain "latte" as substring.
    //   n-gram (word tokens): query "latte" has 1 token; field "milk foam"
    //   has tokens ["milk","foam"] — 0 overlap → no score from name.
    //   But notes "oat milk latte style drink" contains "latte" as substring
    //   → STRONG on notes (weight 1). Still outscored by strongItem's STRONG
    //   on name (weight 3): 1000*3 > 1000*1.
    // Use a weakItem that only gets WEAK: notes = "has that milk froth vibe"
    //   → no substring "latte", token "latte" not in ["has","that","milk","froth","vibe"]
    //   → score 0. Place = "latteria" → contains "latte" as substring → STRONG on place
    //   — so make place empty and notes have a partial token overlap only.
    // Cleanest setup: weakItem matches via 2-gram on a CJK query, strongItem exact.
    // For latin: use multi-word query where weakItem shares only one of two tokens.
    // query "iced latte": tokens ["iced","latte"]
    //   strongItem name "iced latte" → exact match → EXACT tier.
    //   weakItem  name "latte vibes" → contains "latte" (substring) → STRONG tier.
    //   — both would be strong/exact, no WEAK competitor.
    //
    // True WEAK competitor: item where the full query string is NOT a substring,
    // but some tokens match.  Use notes-only partial token hit at WEAK tier
    // by ensuring the field value shares exactly one token and doesn't contain
    // the full query as a substring.
    //
    // query "cold brew": tokens ["cold","brew"]
    //   strongItem: name "cold brew latte" → contains "cold brew" → STRONG, weight 3
    //   weakItem:   name "iced drink",  notes "nice cold afternoon" →
    //     name: no substring "cold brew"; tokens ["iced","drink"] → 0 hits
    //     notes: no substring "cold brew"; tokens ["nice","cold","afternoon"] →
    //       1 hit ("cold") out of 2 query tokens → overlap ratio 0.5 → WEAK score
    // This gives a real STRONG vs WEAK competition on the same query.
    const strongCompetitor = taste({ name: "cold brew latte" });
    const weakCompetitor = taste({ name: "iced drink", notes: "nice cold afternoon" });

    const results = searchTastes([weakCompetitor, strongCompetitor], "cold brew");

    // Both must appear.
    expect(results).toHaveLength(2);
    // Strong must rank first.
    expect(results[0].item).toBe(strongCompetitor);
    expect(results[0].strength).toBe("strong");
    // Weak must rank second.
    expect(results[1].item).toBe(weakCompetitor);
    expect(results[1].strength).toBe("weak");
  });

  it("SCORE_THRESHOLD.exact >= SCORE_THRESHOLD.strong >= SCORE_THRESHOLD.weak", () => {
    expect(SCORE_THRESHOLD.exact).toBeGreaterThan(SCORE_THRESHOLD.strong);
    expect(SCORE_THRESHOLD.strong).toBeGreaterThan(SCORE_THRESHOLD.weak);
  });
});

// ---------------------------------------------------------------------------
// Field weighting: name hit outranks notes hit (same tier)
// ---------------------------------------------------------------------------

describe("field weighting", () => {
  it("name strong match scores higher than notes strong match", () => {
    const nameHit = taste({ name: "matcha latte", notes: "good drink" });
    const notesHit = taste({ name: "random drink", notes: "matcha latte is great" });
    const results = searchTastes([notesHit, nameHit], "matcha latte");
    expect(results[0].item).toBe(nameHit);
  });

  it("place strong match scores higher than notes strong match", () => {
    const placeHit = taste({ name: "coffee", place: "Blue Bottle", notes: "good" });
    const notesHit = taste({ name: "coffee", place: "somewhere", notes: "Blue Bottle is amazing" });
    const results = searchTastes([notesHit, placeHit], "blue bottle");
    expect(results[0].item).toBe(placeHit);
  });
});

// ---------------------------------------------------------------------------
// Notes-content hit regression
// (old LibraryView substring filter only searched name/place — notes were invisible)
// ---------------------------------------------------------------------------

describe("notes search regression", () => {
  it("returns an item matched only in notes field", () => {
    const item = taste({
      name: "Mystery Drink",
      place: "Café X",
      notes: "surprisingly good jasmine flavor",
    });
    const results = searchTastes([item], "jasmine");
    expect(results).toHaveLength(1);
    expect(results[0].matchedFields).toContain("notes");
  });

  it("notes-only hit has 'notes' as the only matchedField when name/place don't match", () => {
    const item = taste({ name: "Tea", place: "Shop", notes: "osmanthus aroma" });
    const results = searchTastes([item], "osmanthus");
    expect(results[0].matchedFields).toEqual(["notes"]);
  });

  it("notes match is returned even when other items have a stronger name match", () => {
    const notesItem = taste({ name: "Drink A", notes: "great cold brew flavor" });
    const nameItem = taste({ name: "cold brew", notes: "" });
    const results = searchTastes([notesItem, nameItem], "cold brew");
    // Both should appear; nameItem ranks higher
    expect(results.some((r) => r.item === notesItem)).toBe(true);
    expect(results[0].item).toBe(nameItem);
  });
});

// ---------------------------------------------------------------------------
// CJK query — 2-gram tokenization
// ---------------------------------------------------------------------------

describe("CJK query", () => {
  it("matches a CJK substring in name", () => {
    const item = taste({ name: "拉面" });
    const results = searchTastes([item], "拉面");
    expect(results).toHaveLength(1);
    expect(results[0].strength).toBe("exact");
  });

  it("matches partial CJK (n-gram overlap) in notes", () => {
    const item = taste({ name: "Noodles", notes: "有拉面的香味" });
    const results = searchTastes([item], "拉面");
    expect(results).toHaveLength(1);
    expect(results[0].matchedFields).toContain("notes");
  });

  it("CJK substring match returns strong tier", () => {
    const item = taste({ name: "珍珠奶茶特调" });
    const results = searchTastes([item], "珍珠奶茶");
    expect(results[0].strength).toBe("strong");
  });

  it("single CJK char (1-char query) returns results", () => {
    const item = taste({ name: "拉面" });
    const results = searchTastes([item], "拉");
    expect(results).toHaveLength(1);
    expect(results[0].item).toBe(item);
  });
});

// ---------------------------------------------------------------------------
// Mixed CJK + Latin
// ---------------------------------------------------------------------------

describe("mixed CJK + latin query", () => {
  it("matches an item whose name contains the latin portion", () => {
    const item = taste({ name: "Boba Tea 珍珠奶茶" });
    const results = searchTastes([item], "boba");
    expect(results).toHaveLength(1);
  });

  it("matches an item whose name contains the CJK portion", () => {
    const item = taste({ name: "Boba Tea 珍珠奶茶" });
    const results = searchTastes([item], "珍珠");
    expect(results).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Normalization edge cases
// ---------------------------------------------------------------------------

describe("normalization in search", () => {
  it("is case-insensitive", () => {
    const item = taste({ name: "Caramel Latte" });
    expect(searchTastes([item], "CARAMEL")).toHaveLength(1);
    expect(searchTastes([item], "caramel")).toHaveLength(1);
  });

  it("matches despite punctuation in query", () => {
    const item = taste({ name: "Taco's" });
    // After normalization both become "tacos"
    expect(searchTastes([item], "taco's")).toHaveLength(1);
  });

  it("ignores leading/trailing whitespace in query", () => {
    const item = taste({ name: "Ramen" });
    expect(searchTastes([item], "  ramen  ")).toHaveLength(1);
  });
});
