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
  CreateTasteInput,
  UpdateTasteInput,
  Stats,
  User,
  ProviderStatus,
  AuthResponse,
  RegisterInput,
  LoginInput,
  RedeemResponse,
} from "./types";

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
    const text = await res.text().catch(() => "");
    throw new Error(`API ${init?.method ?? "GET"} ${url} → ${res.status}: ${text}`);
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
}): Promise<Taste[]> {
  const qs = new URLSearchParams();
  if (params?.q) qs.set("q", params.q);
  if (params?.filter && params.filter !== "All") qs.set("filter", params.filter);
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
      // Expo 56+ fetch requires Blob/File entries — the legacy RN {uri,name,type}
      // convention triggers "Unsupported FormDataPart implementation".
      const blob = await fetch(photo.uri).then((r) => r.blob());
      fd.append("photo", new File([blob], photo.name, { type: photo.type }));
    } else {
      fd.append("photo", photo);
    }
    fd.append("name", input.name);
    fd.append("verdict", input.verdict);
    if (input.place) fd.append("place", input.place);
    if (input.price) fd.append("price", input.price);
    if (input.notes) fd.append("notes", input.notes);
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
