/* Yummy or Not — typed API client (shared, RN + web).
   Routes hit <BASE_URL>/api/tastes and <BASE_URL>/api/stats.
   BASE_URL comes from EXPO_PUBLIC_API_URL; empty string = same-origin (web).
   Photo upload uses multipart/form-data with field `photo`;
   all other creates/updates use JSON.

   Photo accepts EITHER a browser `File` (web) OR a React Native file
   descriptor `{ uri, name, type }` — the FormData append differs per platform. */

import type { Taste, CreateTasteInput, UpdateTasteInput, Stats } from "./types";

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

function isRNFile(photo: PhotoInput): photo is RNFile {
  return typeof (photo as RNFile).uri === "string";
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, init);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API ${init?.method ?? "GET"} ${url} → ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
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
    // Web `File` appends directly; RN file appends as a {uri,name,type} object.
    if (isRNFile(photo)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fd.append("photo", { uri: photo.uri, name: photo.name, type: photo.type } as any);
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
