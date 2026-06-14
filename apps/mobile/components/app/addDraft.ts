/* ============================================================
   YUMMY OR NOT — AddModal draft autosave (client-side persistence)

   User feedback: closing the Add screen (Cancel button, the header ✕,
   hardware back, or a swipe-dismiss) threw away everything typed — a
   mis-tapped Cancel lost the whole entry. The fix keeps an autosaved
   draft so the next time the Add screen opens, the in-progress entry is
   restored instead of starting blank.

   Persistence model (mirrors _useActiveTaster):
   - One draft per account, namespaced `yon_add_draft:<userId>` so a draft
     never leaks across accounts. Signed-out edits use the `anon` key.
   - A draft is only stored when it actually has content (isDraftMeaningful);
     an empty form removes any stale draft instead of persisting blank state.
   - The draft is cleared once a taste is successfully created.
   All reads/writes are best-effort — a storage failure must never block the
   Add flow, so every call swallows its error.
   ============================================================ */

import AsyncStorage from '@react-native-async-storage/async-storage'
import type { PhotoInput, TasteStatus, Verdict } from '@yon/shared'

const STORAGE_PREFIX = 'yon_add_draft:'

/** The serialisable snapshot of the AddModal form. */
export interface AddDraft {
  mode: TasteStatus
  name: string
  place: string
  price: string
  notes: string
  verdict: Verdict | null
  picked: string[]
  lat: number | null
  lng: number | null
  /** The upload payload (RNFile uri on native, File is dropped — see below). */
  photo: PhotoInput | null
  /** Local uri used to render the photo preview. */
  photoPreview: string | null
}

function storageKey(userId: string | null): string {
  return `${STORAGE_PREFIX}${userId ?? 'anon'}`
}

/**
 * True when the draft holds something worth restoring. A blank form (the
 * initial state, or a form the user emptied out) is NOT meaningful, so it is
 * never persisted and never restored — that would surprise the user with stale
 * fields on a fresh open.
 */
export function isDraftMeaningful(d: AddDraft): boolean {
  return Boolean(
    d.name.trim() ||
      d.place.trim() ||
      d.price.trim() ||
      d.notes.trim() ||
      d.verdict ||
      d.picked.length > 0 ||
      d.photoPreview,
  )
}

/** Read the persisted draft for an account, or null when there is none. */
export async function loadDraft(userId: string | null): Promise<AddDraft | null> {
  try {
    const raw = await AsyncStorage.getItem(storageKey(userId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as AddDraft
    return isDraftMeaningful(parsed) ? parsed : null
  } catch {
    return null
  }
}

/**
 * Persist a draft for an account. A non-meaningful (empty) draft removes any
 * existing stored draft instead of writing blank state.
 */
export async function saveDraft(userId: string | null, draft: AddDraft): Promise<void> {
  try {
    if (!isDraftMeaningful(draft)) {
      await AsyncStorage.removeItem(storageKey(userId))
      return
    }
    await AsyncStorage.setItem(storageKey(userId), JSON.stringify(draft))
  } catch {
    // Best-effort: a failed autosave must not break the Add flow.
  }
}

/** Drop the persisted draft for an account (called after a successful save). */
export async function clearDraft(userId: string | null): Promise<void> {
  try {
    await AsyncStorage.removeItem(storageKey(userId))
  } catch {
    // Best-effort.
  }
}
