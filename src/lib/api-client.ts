/* Yummy or Not — typed API client.
   All routes hit same-origin /api/tastes and /api/stats.
   Photo upload uses multipart/form-data with field `photo`;
   all other creates/updates use JSON. */

import type {
  Taste,
  CreateTasteInput,
  UpdateTasteInput,
  Stats,
  User,
  OAuthProvider,
  RegisterInput,
  LoginInput,
} from "@/lib/types";

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API ${init?.method ?? "GET"} ${path} → ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

/** Like apiFetch but, on failure, throws an Error whose message is the server's
 *  machine-readable `error` code (e.g. "email_taken") for the UI to localize. */
async function authFetch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `http_${res.status}`);
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
  photo?: File | null
): Promise<Taste> {
  if (photo) {
    const fd = new FormData();
    fd.append("photo", photo);
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

export interface ProviderStatus {
  id: OAuthProvider;
  label: string;
  audience: "domestic" | "international";
  configured: boolean;
}

/** Current session + which social logins are available. user is null if signed out. */
export async function getMe(): Promise<{ user: User | null; providers: ProviderStatus[] }> {
  return apiFetch<{ user: User | null; providers: ProviderStatus[] }>("/api/auth/me");
}

/** Phone login step 1 — request an SMS code. devCode is set outside production. */
export async function requestOtp(phone: string): Promise<{ ok: true; devCode?: string }> {
  return authFetch("/api/auth/otp/request", { phone });
}

/** Phone login step 2 — verify the code; signs in (creating the account if new). */
export async function verifyOtp(phone: string, code: string): Promise<{ user: User }> {
  return authFetch("/api/auth/otp/verify", { phone, code });
}

export async function registerEmail(input: RegisterInput): Promise<{ user: User }> {
  return authFetch("/api/auth/register", input);
}

export async function loginEmail(input: LoginInput): Promise<{ user: User }> {
  return authFetch("/api/auth/login", input);
}

export async function logout(): Promise<void> {
  await fetch("/api/auth/logout", { method: "POST" });
}

/** URL to start a social login redirect (used as an <a href>). */
export function oauthStartUrl(provider: OAuthProvider): string {
  return `/api/auth/oauth/${provider}`;
}
