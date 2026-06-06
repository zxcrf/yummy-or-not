/* ============================================================
   YUMMY OR NOT — Shared types & API contract.
   This is the integration contract between the backend (API/DB),
   the design-system components, and the app surfaces.
   All three workstreams import from here. Do not break these shapes.
   ============================================================ */

/** The three sacred verdicts. */
export type Verdict = "yum" | "meh" | "nah";

/** A logged taste — one food/drink the user recorded a verdict on.
 *  Mirrors the `tastes` table (see db/schema.sql) in camelCase. */
export interface Taste {
  id: string;
  name: string;
  place: string;
  /** Display price string as entered, e.g. "$5.80". May be "" / "—". */
  price: string;
  verdict: Verdict;
  tags: string[];
  boughtCount: number;
  /** Human display date, e.g. "2 weeks ago" / "just now". Derived from createdAt. */
  date: string;
  notes: string;
  /** Image URL (uploaded path under /uploads/... or a remote URL). "" if none. */
  image: string;
  /** ISO timestamp from the DB. */
  createdAt: string;
}

/** Payload to create a taste (POST /api/tastes). `image` optional — when uploading
 *  a file, send multipart/form-data with field `photo`; otherwise JSON with these fields. */
export interface CreateTasteInput {
  name: string;
  place?: string;
  price?: string;
  verdict: Verdict;
  tags?: string[];
  notes?: string;
  image?: string;
}

/** Payload to update a taste (PATCH /api/tastes/[id]). All fields optional. */
export type UpdateTasteInput = Partial<CreateTasteInput> & {
  /** Increment the bought counter by this amount (e.g. 1). */
  incrementBought?: number;
};

/** GET /api/stats response. */
export interface Stats {
  total: number;
  yum: number;
  meh: number;
  nah: number;
  /** Money-saved framing — display string, e.g. "$12.75". */
  savedAmount: string;
}

/* ----------------------------------------------------------------
   API CONTRACT (implemented by the backend workstream)
   ----------------------------------------------------------------
   GET    /api/tastes?q=<search>&filter=<tag|All>
            -> Taste[]        (newest first; q matches name/place,
                               filter matches a tag or "All")
   POST   /api/tastes
            body: CreateTasteInput as JSON, OR multipart/form-data
                  with the same fields + optional `photo` file.
            -> Taste          (201)
   GET    /api/tastes/:id      -> Taste | 404
   PATCH  /api/tastes/:id
            body: UpdateTasteInput -> Taste
   DELETE /api/tastes/:id      -> { ok: true }
   GET    /api/stats           -> Stats
   ---------------------------------------------------------------- */

/** Canonical filter chips shown in the library (first is the "all" sentinel). */
export const FILTERS = [
  "All",
  "Boba",
  "Coffee",
  "Ramen",
  "Dessert",
  "Burger",
  "Pizza",
  "Spicy",
] as const;

/** Tag choices offered in the add-a-taste form. */
export const TAG_CHOICES = [
  "Boba",
  "Coffee",
  "Ramen",
  "Dessert",
  "Burger",
  "Pizza",
  "Spicy",
  "Sweet",
  "Savory",
] as const;
