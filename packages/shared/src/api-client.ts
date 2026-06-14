/* Yummy or Not — typed API client (shared, RN + web).
   Routes hit <BASE_URL>/api/tastes, /api/stats and /api/auth/*.
   BASE_URL comes from EXPO_PUBLIC_API_URL; empty string = same-origin (web).
   Photo upload uses multipart/form-data with field `photo`;
   all other creates/updates use JSON.

   Photo accepts EITHER a browser `File` (web) OR a React Native file
   descriptor `{ uri, name, type }` — the FormData append differs per platform.

   Auth transport: the API host is a different origin from the app, so we use a
   bearer token rather than (only) a cookie. The token is held in module memory
   and sent as `Authorization: Bearer <token>` on every request. Persistence
   across launches is the caller's job (mobile AuthProvider loads it from
   AsyncStorage and calls setAuthToken). This module stays platform-neutral so
   apps/api can import the types without pulling in RN storage deps. */

import type {
  Taste,
  TastePurchase,
  CreateTasteInput,
  UpdateTasteInput,
  Stats,
  User,
  UpdateUserInput,
  ProviderStatus,
  AuthResponse,
  RegisterInput,
  LoginInput,
  PasswordResetVerifyInput,
  RedeemResponse,
  OriginalPhotoResponse,
  UserTag,
  CreateTagInput,
  RenameTagInput,
  MintShareResponse,
  SharePreview,
  Taster,
  CreateTasterInput,
  UpdateTasterInput,
} from "./types";
import { ProRequiredError } from "./types";

/** React Native multipart file descriptor (no `File` in RN). */
export interface RNFile {
  uri: string;
  name: string;
  type: string;
}

/** A photo argument may be a browser File (web) or an RNFile (native). */
export type PhotoInput = File | RNFile;

/** Base URL for the API. Empty string = same-origin (web served by the API host). */
const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? "";

/* ── Bearer-token store (in-memory; persistence is the caller's job) ──────── */

let authToken: string | null = null;

/** Set (or clear, with null) the bearer token sent on every request. */
export function setAuthToken(token: string | null): void {
  authToken = token;
}

/** The current in-memory bearer token, or null when signed out. */
export function getAuthToken(): string | null {
  return authToken;
}

function isRNFile(photo: PhotoInput): photo is RNFile {
  return typeof (photo as RNFile).uri === "string";
}

/** Merge the Authorization header into a request's headers when signed in. */
function withAuth(init?: RequestInit): RequestInit {
  const headers = new Headers(init?.headers);
  if (authToken) headers.set("Authorization", `Bearer ${authToken}`);
  return { ...init, headers };
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, withAuth(init));
  if (!res.ok) {
    // Parse the JSON body to surface the server's machine-readable `error` code
    // (e.g. "name_conflict", "not_found") — same convention as authPost so
    // callers can reliably detect specific errors via err.message.
    const data = await res.json().catch(() => null);
    const code = (data as { error?: string } | null)?.error;
    throw new Error(code ?? `http_${res.status}`);
  }
  return res.json() as Promise<T>;
}

/** POST JSON to an auth route; on failure throw an Error whose message is the
 *  server's machine-readable `error` code (e.g. "email_taken") for the UI to
 *  localize. On success the bearer token (if any) is stored for this session. */
async function authPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, withAuth({
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `http_${res.status}`);
  const token = (data as { token?: string }).token;
  if (token) setAuthToken(token);
  return data as T;
}

export async function listTastes(params?: {
  q?: string;
  filter?: string;
  /** Lifecycle filter. Omitted → server default 'tasted' (old-client compat).
   *  Pass 'all' to fetch both tasted + todo (the single shared mobile list),
   *  or 'todo' for the wishlist only. */
  status?: "tasted" | "todo" | "all";
  /** S3b: restrict to one taster persona's records. */
  taster?: string;
}): Promise<Taste[]> {
  const qs = new URLSearchParams();
  if (params?.q) qs.set("q", params.q);
  if (params?.filter && params.filter !== "All") qs.set("filter", params.filter);
  if (params?.status) qs.set("status", params.status);
  if (params?.taster) qs.set("taster", params.taster);
  const suffix = qs.toString() ? `?${qs}` : "";
  return apiFetch<Taste[]>(`/api/tastes${suffix}`);
}

export async function getTaste(id: string): Promise<Taste> {
  return apiFetch<Taste>(`/api/tastes/${id}`);
}

export async function createTaste(
  input: CreateTasteInput,
  photo?: PhotoInput | null
): Promise<Taste> {
  if (photo) {
    const fd = new FormData();
    if (isRNFile(photo)) {
      // Expo 56+ fetch serializes FormData parts that are strings, Blobs, or
      // objects exposing bytes() (expo-file-system File / ExpoBlob); the
      // legacy RN {uri,name,type} convention throws "Unsupported FormDataPart
      // implementation" (#32). Response.blob() / new Blob([ArrayBuffer]) are
      // also off-limits: RN's Blob constructor can't be built from
      // ArrayBuffers and throws "Creating blobs from 'ArrayBuffer'..." on
      // device. So read the file as an ArrayBuffer and append a bytes()-shaped
      // part carrying the filename and content type expo's serializer reads.
      const buffer = await fetch(photo.uri).then((r) => r.arrayBuffer());
      const part = {
        name: photo.name,
        type: photo.type,
        size: buffer.byteLength,
        bytes: () => new Uint8Array(buffer),
      };
      fd.append("photo", part as unknown as Blob);
    } else {
      fd.append("photo", photo);
    }
    fd.append("name", input.name);
    // verdict is optional now (todo rows have none); only send when present.
    if (input.verdict) fd.append("verdict", input.verdict);
    if (input.status) fd.append("status", input.status);
    if (input.place) fd.append("place", input.place);
    if (input.price) fd.append("price", input.price);
    if (input.notes) fd.append("notes", input.notes);
    if (input.lat != null) fd.append("lat", String(input.lat));
    if (input.lng != null) fd.append("lng", String(input.lng));
    // S3b: keep the active-persona attribution on the photo path too. Without
    // this, every save WITH a photo silently fell back to the self-taster
    // regardless of the active taster (the JSON path already sends it).
    if (input.tasterId) fd.append("tasterId", input.tasterId);
    input.tags?.forEach((t) => fd.append("tags", t));
    return apiFetch<Taste>("/api/tastes", { method: "POST", body: fd });
  }
  return apiFetch<Taste>("/api/tastes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function updateTaste(
  id: string,
  input: UpdateTasteInput
): Promise<Taste> {
  return apiFetch<Taste>(`/api/tastes/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function deleteTaste(id: string): Promise<void> {
  await apiFetch<{ ok: true }>(`/api/tastes/${id}`, { method: "DELETE" });
}

export async function getStats(): Promise<Stats> {
  return apiFetch<Stats>("/api/stats");
}

/* ── Auth ──────────────────────────────────────────────────────────────── */

/** Current session + which social logins are available. user is null if signed out.
 *  Sends the stored bearer token; a 401 surfaces as a thrown Error (treat as
 *  signed-out by the caller). */
export async function getMe(): Promise<{ user: User | null; providers: ProviderStatus[] }> {
  return apiFetch<{ user: User | null; providers: ProviderStatus[] }>("/api/auth/me");
}

/** Phone login step 1 — request an SMS code. devCode is set outside production. */
export async function requestOtp(phone: string): Promise<{ ok: true; devCode?: string }> {
  return authPost("/api/auth/otp/request", { phone });
}

/** Phone login step 2 — verify the code; signs in (creating the account if new). */
export async function verifyOtp(phone: string, code: string): Promise<AuthResponse> {
  return authPost<AuthResponse>("/api/auth/otp/verify", { phone, code });
}

export async function registerEmail(input: RegisterInput): Promise<AuthResponse> {
  return authPost<AuthResponse>("/api/auth/register", input);
}

/** Password reset step 1 — request a reset email. Always resolves ok (the server
 *  is enumeration-safe and never reveals whether the email is registered).
 *  devToken is set outside production. */
export async function requestPasswordReset(
  email: string
): Promise<{ ok: true; devToken?: string }> {
  return authPost("/api/auth/password/reset-request", { email });
}

/** Password reset step 2 — submit the emailed token + a new password. Throws an
 *  Error whose message is the server's code (e.g. "bad_token", "weak_password")
 *  for the UI to localize. */
export async function verifyPasswordReset(input: PasswordResetVerifyInput): Promise<{ ok: true }> {
  return authPost("/api/auth/password/reset-verify", input);
}

export async function loginEmail(input: LoginInput): Promise<AuthResponse> {
  return authPost<AuthResponse>("/api/auth/login", input);
}

/** Redeem a promo code on the signed-in account. Throws an Error whose message
 *  is the server's code (e.g. "invalid_code", "already_redeemed") for the UI to
 *  localize. On success returns the updated user (new plan). */
export async function redeemPromo(code: string): Promise<RedeemResponse> {
  return authPost<RedeemResponse>("/api/promo/redeem", { code });
}

/** Revoke the server session and clear the in-memory token. */
export async function logout(): Promise<void> {
  try {
    await fetch(`${BASE_URL}/api/auth/logout`, withAuth({ method: "POST" }));
  } finally {
    setAuthToken(null);
  }
}

/** Absolute URL to start a social login redirect (open in a browser).
 *  Web-first; native deep-link return is not wired yet. */
export function oauthStartUrl(provider: string): string {
  return `${BASE_URL}/api/auth/oauth/${provider}`;
}

/** GET /api/tastes/:id/original — fetch a short-lived presigned URL to the
 *  full-resolution original upload. Requires the caller to be on the Pro plan.
 *  Throws ProRequiredError (code "pro_required") on 403 so the UI can show an
 *  upgrade prompt rather than a generic error message. */
export async function getOriginalPhotoUrl(
  id: string
): Promise<OriginalPhotoResponse> {
  const url = `${BASE_URL}/api/tastes/${id}/original`;
  const res = await fetch(url, withAuth());
  if (res.status === 403) {
    const data = await res.json().catch(() => ({}));
    if ((data as { error?: string }).error === "pro_required") {
      throw new ProRequiredError();
    }
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API GET ${url} → ${res.status}: ${text}`);
  }
  return res.json() as Promise<OriginalPhotoResponse>;
}

/* ── Tags ──────────────────────────────────────────────────────────────────── */

/** GET /api/tags — list the signed-in user's tag candidate set (lazy-seeded on first call). */
export async function getTags(): Promise<UserTag[]> {
  return apiFetch<UserTag[]>("/api/tags");
}

/** POST /api/tags — create or upsert a tag by name. Returns the tag row (201). */
export async function createTag(input: CreateTagInput): Promise<UserTag> {
  return apiFetch<UserTag>("/api/tags", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

/** DELETE /api/tags/:id — remove a tag from the candidate set. Never rewrites tastes.tags. */
export async function deleteTag(id: string): Promise<void> {
  await apiFetch<{ ok: true }>(`/api/tags/${id}`, { method: "DELETE" });
}

/** PATCH /api/tags/:id — rename a tag in the candidate set. Never rewrites tastes.tags. */
export async function renameTag(id: string, input: RenameTagInput): Promise<UserTag> {
  return apiFetch<UserTag>(`/api/tags/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

/* ── Tasters (S3b personas) ─────────────────────────────────────────────────── */

/** GET /api/tasters — list the account's taster personas (self + others). */
export async function getTasters(): Promise<Taster[]> {
  return apiFetch<Taster[]>("/api/tasters");
}

/** POST /api/tasters — create a persona. Pro only; throws "pro_required" on 403. */
export async function createTaster(input: CreateTasterInput): Promise<Taster> {
  return apiFetch<Taster>("/api/tasters", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

/** PATCH /api/tasters/:id — rename / re-avatar a persona. Pro only. */
export async function updateTaster(id: string, input: UpdateTasterInput): Promise<Taster> {
  return apiFetch<Taster>(`/api/tasters/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

/** DELETE /api/tasters/:id — remove a persona. Pro only; the self-taster is protected. */
export async function deleteTaster(id: string): Promise<void> {
  await apiFetch<{ ok: true }>(`/api/tasters/${id}`, { method: "DELETE" });
}

/* ── Repurchase warnings & purchases ───────────────────────────────────────── */

/** POST /api/tastes/:id/purchases — record an additional purchase of a taste.
 *  Returns the new purchase row and the updated derived boughtCount. */
export async function addPurchase(
  tasteId: string,
  input: { price?: string | null; place?: string | null } = {}
): Promise<{ purchase: TastePurchase; boughtCount: number }> {
  return apiFetch<{ purchase: TastePurchase; boughtCount: number }>(
    `/api/tastes/${tasteId}/purchases`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }
  );
}

/** GET /api/geocode/reverse — server-side reverse geocode (AMap for China, Nominatim elsewhere).
 *  Returns { place: string | null }. Never throws on provider failure. */
export async function reverseGeocode(
  lat: number,
  lng: number,
): Promise<{ place: string | null }> {
  return apiFetch<{ place: string | null }>(
    `/api/geocode/reverse?lat=${lat}&lng=${lng}`,
  );
}

/** PATCH /api/user — update signed-in user settings (e.g. warningsEnabled). */
export async function updateUser(input: UpdateUserInput): Promise<{ user: User }> {
  return apiFetch<{ user: User }>("/api/user", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

/* ── S3a share / import ─────────────────────────────────────────────────────── */

/** POST /api/tastes/:id/share — owner mints a thin importable share token.
 *  Returns { token, deepLink, importCode, expiresAt }. The deepLink + importCode
 *  are appended to the system share text (alongside the existing PNG card). */
export async function mintShare(tasteId: string): Promise<MintShareResponse> {
  return apiFetch<MintShareResponse>(`/api/tastes/${tasteId}/share`, {
    method: "POST",
  });
}

/** DELETE /api/tastes/:id/share — owner revokes outstanding share tokens.
 *  Revocation is immediate: the server stops issuing preview presigns. */
export async function revokeShare(tasteId: string): Promise<void> {
  await apiFetch<{ ok: true }>(`/api/tastes/${tasteId}/share`, {
    method: "DELETE",
  });
}

/** GET /api/share/:token — live preview of a shared taste + short presign.
 *  A revoked/expired/source-deleted share answers 410, which apiFetch surfaces
 *  as an Error whose message is "share_gone" for the UI to localize. No auth
 *  required (the unguessable token is the capability). */
export async function getSharePreview(token: string): Promise<SharePreview> {
  return apiFetch<SharePreview>(`/api/share/${token}`);
}

/** POST /api/share/:token/import — copy the shared taste into the signed-in
 *  user's library as a status='todo', verdict=null row (copy-on-import).
 *  Idempotent: a repeat import returns the existing copy. 410 → "share_gone". */
export async function importShare(token: string): Promise<Taste> {
  return apiFetch<Taste>(`/api/share/${token}/import`, { method: "POST" });
}

/** GET /api/share/resolve?code=<importCode> — resolve the printed import code
 *  (the WeChat-forward fallback) back to a live token. 404 → "share_gone". */
export async function resolveImportCode(code: string): Promise<{ token: string }> {
  return apiFetch<{ token: string }>(
    `/api/share/resolve?code=${encodeURIComponent(code)}`,
  );
}

/* ── S3c geo feeds ("附近·热力" heat map) ──────────────────────────────────────── */

/** One precision-5 heat grid cell: the cell geohash and its k-anon count.
 *  The server only returns cells with count >= 3, so sparse cells are absent —
 *  never assume every cell in a viewport is present. */
export interface GeoHeatCell {
  cell: string;
  count: number;
}

/** A single anonymous taste card surfaced by the cell feed. Coarsened to
 *  `gridCell` (precision-5 geohash) — never a precise coordinate or identity. */
export interface GeoFeedCard {
  id: string;
  name: string;
  verdict: string | null;
  image: string;
  imageThumb: string;
  imageDisplay: string;
  gridCell: string;
}

/** GET /api/feed/geo/heat?bbox=minLng,minLat,maxLng,maxLat — the precision-5 heat
 *  grid for a viewport. bbox component order is EXACTLY minLng,minLat,maxLng,maxLat
 *  with literal commas (raw numbers, no encodeURIComponent). A bbox over the cover
 *  cap answers 400 {error:'area_too_large'} → apiFetch rejects Error('area_too_large');
 *  callers gate with isBboxHeatQueryable before calling to avoid that round-trip. */
export async function getGeoHeat(box: {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
}): Promise<GeoHeatCell[]> {
  const bbox = `${box.minLng},${box.minLat},${box.maxLng},${box.maxLat}`;
  return apiFetch<GeoHeatCell[]>(`/api/feed/geo/heat?bbox=${bbox}`);
}

/** GET /api/feed/geo?cell=<geohash5> — the anonymous taste cards in one cell.
 *  A missing/empty cell answers 400 {error:'cell_required'} → rejects
 *  Error('cell_required'). */
export async function getGeoFeedByCell(cell: string): Promise<GeoFeedCard[]> {
  return apiFetch<GeoFeedCard[]>(`/api/feed/geo?cell=${encodeURIComponent(cell)}`);
}
