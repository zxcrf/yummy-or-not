/* ============================================================
   YUMMY OR NOT — Shared types & API contract.
   This is the integration contract between the backend (API/DB),
   the design-system components, and the app surfaces.
   All three workstreams import from here. Do not break these shapes.
   ============================================================ */

/** The three sacred verdicts. */
export type Verdict = "yum" | "meh" | "nah";

/** Subscription tiers. "pro" is the highest tier (see issue #2 pricing). */
export type Plan = "free" | "pro";

/** Free-tier record cap (issue #2: Free ≈ 100 records). Enforced server-side
 *  in POST /api/tastes; surfaced to the client so the UI can warn early. */
export const FREE_TASTE_CAP = 100;

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
  /** Display-quality image URL (presigned R2 or /uploads/... path). "" if none.
   *  Kept as the legacy field name for old-APK compatibility; new code should
   *  prefer imageDisplay for display and imageThumb for list thumbnails. */
  image: string;
  /** Thumbnail URL (≤300 px wide, WebP). Populated after server transcoding.
   *  Falls back to `image` on old records that pre-date variant generation. */
  imageThumb: string;
  /** Display-quality URL (≤1200 px wide, WebP). Same lifetime as `image`.
   *  Falls back to `image` on old records that pre-date variant generation. */
  imageDisplay: string;
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
   AUTH — multi-user accounts & sessions.
   Two onboarding habits are supported side by side:
     • Domestic (China): phone number + SMS one-time code, WeChat.
     • International:     email + password, Google, Apple.

   Transport note (monorepo): the API host (apps/api) is a DIFFERENT
   origin from the app (apps/mobile, RN + RN Web), so auth cannot rely
   on a same-origin httpOnly cookie alone. Every sign-in endpoint returns
   an opaque bearer `token`; the client stores it and sends it as
   `Authorization: Bearer <token>` on subsequent requests. The API also
   sets the cookie (web convenience) and accepts either transport.
   ---------------------------------------------------------------- */

/** A signed-in account, as returned to the client (never includes secrets). */
export interface User {
  id: string;
  displayName: string;
  /** E.164-ish phone, e.g. "+8613800138000". "" if none on file. */
  phone: string;
  /** Lower-cased email. "" if none on file. */
  email: string;
  avatar: string;
  locale: string;
  plan: Plan;
  createdAt: string;
}

/** Social / OAuth providers we can link an account to. */
export type OAuthProvider = "wechat" | "google" | "apple";

/** POST /api/auth/otp/request — start a phone login (domestic habit). */
export interface OtpRequestInput {
  phone: string;
}
/** POST /api/auth/otp/verify — finish a phone login with the texted code. */
export interface OtpVerifyInput {
  phone: string;
  code: string;
}
/** POST /api/auth/register — email sign-up (international habit).
 *  `promoCode` is optional: when present and valid, the new account is
 *  upgraded to the plan the code grants (e.g. pro) on sign-up. */
export interface RegisterInput {
  email: string;
  password: string;
  displayName?: string;
  promoCode?: string;
}
/** POST /api/auth/login — email sign-in. */
export interface LoginInput {
  email: string;
  password: string;
}
/** Shape returned by the auth endpoints that establish a session.
 *  `token` is the bearer token the client must persist and send back. */
export interface AuthResponse {
  user: User;
  token: string;
  /** Present only when a sign-up supplied `RegisterInput.promoCode`: the outcome
   *  of applying that code to the new account. `ok:false` means the account was
   *  created but the code could NOT be applied (e.g. it was exhausted in a race
   *  between validation and redemption) — the client must surface this rather
   *  than silently leaving the user on free, and can offer a retry via
   *  POST /api/promo/redeem. */
  promo?: { ok: true } | { ok: false; error: RedeemError };
}

/* ----------------------------------------------------------------
   PROMO CODES — a code grants a plan (e.g. pro) when redeemed.
   Used two ways:
     • at sign-up   — RegisterInput.promoCode
     • after login  — POST /api/promo/redeem (RedeemInput)
   ---------------------------------------------------------------- */

/** POST /api/promo/redeem — redeem a code on the signed-in account. */
export interface RedeemInput {
  code: string;
}

/** Machine-readable failure reasons for a redemption (localized by the UI). */
export type RedeemError =
  | "invalid_code"
  | "code_expired"
  | "code_exhausted"
  | "already_redeemed";

/** POST /api/promo/redeem success → the updated account (new plan). */
export interface RedeemResponse {
  user: User;
}

/** Secret-free social-login availability summary (drives which buttons show). */
export interface ProviderStatus {
  id: OAuthProvider;
  label: string;
  audience: "domestic" | "international";
  configured: boolean;
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
   GET    /api/tastes/:id/original
            -> { url: string; expiresIn: number }   (Pro users only)
             | 403 { error: "pro_required" }         (free-tier users)
            Returns a short-lived presigned URL to the full-resolution
            original upload. Requires Authorization: Bearer <token>.
   ---------------------------------------------------------------- */

/** Response shape for GET /api/tastes/:id/original (Pro users only). */
export interface OriginalPhotoResponse {
  url: string;
  /** Seconds until the presigned URL expires. */
  expiresIn: number;
}

/** Error thrown by getOriginalPhotoUrl when the caller is on the free plan. */
export class ProRequiredError extends Error {
  readonly code = "pro_required" as const;
  constructor() {
    super("pro_required");
    this.name = "ProRequiredError";
  }
}

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
