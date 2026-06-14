/* ============================================================
   YUMMY OR NOT — Shared types & API contract.
   This is the integration contract between the backend (API/DB),
   the design-system components, and the app surfaces.
   All three workstreams import from here. Do not break these shapes.
   ============================================================ */

/** The three sacred verdicts. */
export type Verdict = "yum" | "meh" | "nah";

/** Lifecycle of a taste record.
 *  - `tasted`: eaten and scored (the default; verdict is always non-null).
 *  - `todo`:   on the 想吃 wishlist, not yet eaten (verdict may be null).
 *  Status only ever moves todo → tasted (promotion / 转正); never the reverse. */
export type TasteStatus = "tasted" | "todo";

/** Subscription tiers. "pro" is the highest tier (see issue #2 pricing). */
export type Plan = "free" | "pro";

/** Free-tier record cap (issue #2: Free ≈ 100 records). Enforced server-side
 *  in POST /api/tastes; surfaced to the client so the UI can warn early. */
export const FREE_TASTE_CAP = 100;

/** One additional purchase of a taste recorded in the purchases ledger. */
export interface TastePurchase {
  id: string;
  tasteId: string;
  /** Price paid, as a numeric string (e.g. "5.80"), or null if not specified. */
  price: string | null;
  /** Place of purchase, or null if not specified. */
  place: string | null;
  /** ISO timestamp of the purchase. */
  createdAt: string;
}

/** A logged taste — one food/drink the user recorded a verdict on.
 *  Mirrors the `tastes` table (see db/schema.sql) in camelCase. */
export interface Taste {
  id: string;
  name: string;
  place: string;
  /** Pure numeric amount string with NO currency symbol, e.g. "5.80". May be "" / "—"; client formats display per language. */
  price: string;
  /** Lifecycle: `tasted` (default, scored) or `todo` (wishlist). */
  status: TasteStatus;
  /** The verdict, or `null` for `todo` rows that have not been scored yet.
   *  Nullable by design (migration 0006): every UI consumer must gate on
   *  `status`/null before rendering a verdict. `tasted` rows are always non-null. */
  verdict: Verdict | null;
  tags: string[];
  /** Derived: 1 + count of taste_purchases rows. Always reflects the ledger. */
  boughtCount: number;
  /** When true the app should show a warning before logging another purchase. */
  warnBeforeBuy: boolean;
  /** Purchase ledger entries for this taste, newest first. */
  purchases: TastePurchase[];
  /** Human display date, e.g. "2 weeks ago" / "just now". Derived from the most
   *  recent activity — the later of `createdAt` and the newest purchase — so a
   *  repurchase refreshes it (and bumps the item's list sort order). */
  date: string;
  notes: string;
  lat?: number | null;
  lng?: number | null;
  /** S3b: the taster persona this record is attributed to. null on legacy rows
   *  that predate the backfill (treated as the owner's self-taster). */
  tasterId?: string | null;
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
  /** Stable storage key of the original photo ("" for none or legacy
   *  http(s)/path images). Safe to use as a client cache key — changes
   *  iff the photo itself changes. */
  imageKey: string;
  /** ISO timestamp from the DB. */
  createdAt: string;
}

/** Payload to create a taste (POST /api/tastes). `image` optional — when uploading
 *  a file, send multipart/form-data with field `photo`; otherwise JSON with these fields. */
export interface CreateTasteInput {
  name: string;
  place?: string;
  price?: string;
  /** Defaults to `tasted` when omitted. `todo` creates a wishlist row. */
  status?: TasteStatus;
  /** Required iff the row is `tasted` (the default). For `status: 'todo'` the
   *  server forces verdict to null regardless of what is sent. */
  verdict?: Verdict;
  tags?: string[];
  notes?: string;
  image?: string;
  lat?: number | null;
  lng?: number | null;
  /** S3b: the active client taster to attribute this record to. Omitted → the
   *  server applies the caller's self-taster (never a wrong persona). */
  tasterId?: string;
}

/** Payload to update a taste (PATCH /api/tastes/[id]). All fields optional. */
export type UpdateTasteInput = Partial<CreateTasteInput> & {
  /** Promote-only: the sole accepted status transition is todo → `tasted`
   *  (转正). The server rejects any other value with `invalid_status_transition`
   *  and requires a non-null verdict (patch value or stored) to promote. */
  status?: "tasted";
  /** @deprecated Use POST /api/tastes/:id/purchases instead. Ignored by server. */
  incrementBought?: number;
  /** Whether to show a repurchase warning for this taste. */
  warnBeforeBuy?: boolean;
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
  /** Whether the repurchase-warning feature is enabled for this account. */
  warningsEnabled: boolean;
  /** Whether this account allows recording location with new tastes. */
  locationEnabled: boolean;
  /** S3b-media capability flag: when false the server rejects video / live-photo
   *  uploads (a still image is always allowed). Independent of `plan`. */
  mediaEnabled: boolean;
  /** S3c: default visibility applied to NEW records ('private' | 'shared').
   *  The You-page "new records default to" row binds this. */
  defaultVisibility: 'private' | 'shared';
  createdAt: string;
}

/** PATCH /api/user — update user settings. */
export interface UpdateUserInput {
  /** Enable or disable repurchase warnings globally for this account. */
  warningsEnabled?: boolean;
  /** Enable or disable location capture for this account. */
  locationEnabled?: boolean;
  /** Display name (nickname). Trimmed, 1–50 chars. */
  displayName?: string;
  /** S3c: default visibility for new records ('private' | 'shared'). */
  defaultVisibility?: 'private' | 'shared';
}

/* ----------------------------------------------------------------
   TASTERS — S3b persona model.
   A taster is a lightweight profile under an owner account (no separate
   login), so you can log a partner's / family member's taste without them
   having the app. Every account has exactly one is_self taster (its own
   default, undeletable). Multi-taster CRUD is pro-gated server-side.
   ---------------------------------------------------------------- */

/** A taster persona owned by an account. Mirrors the `tasters` table (camelCase). */
export interface Taster {
  id: string;
  /** The owner account this persona belongs to. */
  ownerAccountId: string;
  /** Optional family container this taster is hung under. null if none. */
  familyId: string | null;
  displayName: string;
  avatar: string;
  /** True for the owner's own default persona (undeletable; the implicit default
   *  attribution when no taster is chosen). Exactly one per account. */
  isSelf: boolean;
  createdAt: string;
}

/** POST /api/tasters — create a persona (pro only). */
export interface CreateTasterInput {
  displayName: string;
  avatar?: string;
}

/** PATCH /api/tasters/:id — rename / re-avatar a persona (pro only). */
export interface UpdateTasterInput {
  displayName?: string;
  avatar?: string;
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
/** POST /api/auth/password/reset-request — start an email password reset.
 *  Always answered with 200 (enumeration-safe), so the response never reveals
 *  whether the email is registered. `devToken` is returned outside production. */
export interface PasswordResetRequestInput {
  email: string;
}
/** POST /api/auth/password/reset-verify — finish a reset with the emailed token. */
export interface PasswordResetVerifyInput {
  email: string;
  token: string;
  newPassword: string;
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

/* ----------------------------------------------------------------
   S3a — single-card share → import into recipient to-taste.
   ---------------------------------------------------------------- */

/** Response from POST /api/tastes/:id/share (owner mints a thin token). */
export interface MintShareResponse {
  /** The crypto-random, non-enumerable share token. */
  token: string;
  /** Deep link to embed in the share text: yummyornot://import/<token>. */
  deepLink: string;
  /** Short, token-derived code printed on the card (WeChat-forward fallback). */
  importCode: string;
  /** ISO expiry, or null when the token does not expire (owner may still revoke). */
  expiresAt: string | null;
}

/** Live preview returned by GET /api/share/:token (source read at request time).
 *  photoUrl is a SHORT-lived (<=60s) presign of the source ORIGINAL — never the
 *  owner's persisted/long-lived URL. */
export interface SharePreview {
  name: string;
  place: string;
  price: string;
  verdict: Verdict | null;
  tags: string[];
  notes: string;
  /** Short-lived presigned URL to the source photo, or "" when there is none. */
  photoUrl: string;
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

/** A tag in the user's candidate set (GET/POST/PATCH/DELETE /api/tags). */
export interface UserTag {
  id: string;
  name: string;
  createdAt: string;
}

/** POST /api/tags body. */
export interface CreateTagInput {
  name: string;
}

/** PATCH /api/tags/:id body. */
export interface RenameTagInput {
  name: string;
}

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
