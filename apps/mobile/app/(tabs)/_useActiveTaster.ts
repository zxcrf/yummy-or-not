/* ============================================================
   YUMMY OR NOT — active taster (client selection state, S3b)

   The active taster is a CLIENT choice persisted in the app
   (§S3b "active taster = 客户端选择态（持久化在 app）"). null means the
   self-taster default — the owner's own records, no explicit selection.
   POST /api/tastes carries the active taster id; absent → server applies
   the self-taster.

   Module-level state + subscriber set (mirrors _useTastes / _useTags):
   - The persisted key is namespaced per account (yon_active_taster:<userId>)
     so switching accounts never leaks the previous account's active taster.
   - setActiveTasterUser() is called by AuthProvider on sign-in / sign-out; it
     drops the in-memory selection, emits null so mounted views reset, then
     re-hydrates the new account's persisted choice.
   - An epoch guards async hydration so a slow read for a previous account can
     never publish into the current one.
   ============================================================ */

import { useEffect, useRef, useState } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'

const STORAGE_PREFIX = 'yon_active_taster:'

// ----------------------------------------------------------------
// Module state — shared across every hook consumer.
// ----------------------------------------------------------------

/** The active taster id, or null for the self-taster default. */
let active: string | null = null
/** Current account id scoping the storage key (null when signed out). */
let userId: string | null = null
/** Bumped on every account switch so a stale hydration read is discarded. */
let epoch = 0

type Listener = (value: string | null) => void
const listeners = new Set<Listener>()

function storageKey(id: string | null): string {
  return `${STORAGE_PREFIX}${id ?? 'anon'}`
}

function emit(): void {
  for (const l of listeners) l(active)
}

/** Load the persisted active taster for the current account into memory. */
async function hydrate(): Promise<void> {
  const captured = epoch
  const key = storageKey(userId)
  let stored: string | null = null
  try {
    stored = await AsyncStorage.getItem(key)
  } catch {
    stored = null
  }
  // Account switched while we were reading — discard this result.
  if (epoch !== captured) return
  active = stored
  emit()
}

// ----------------------------------------------------------------
// Public module API
// ----------------------------------------------------------------

/**
 * Point the active-taster state at a (new) account. Call on sign-in and
 * sign-out. Resets the in-memory selection to the self default (null), emits so
 * mounted views clear immediately, then re-hydrates the new account's choice.
 */
export function setActiveTasterUser(id: string | null): void {
  userId = id
  epoch++
  active = null
  emit()
  void hydrate()
}

/**
 * Select the active taster (null = back to the self default). Persists the
 * choice under the current account's key and notifies every mounted view.
 */
export async function setActiveTaster(id: string | null): Promise<void> {
  active = id
  emit()
  const key = storageKey(userId)
  try {
    if (id === null) {
      await AsyncStorage.removeItem(key)
    } else {
      await AsyncStorage.setItem(key, id)
    }
  } catch {
    // Persistence is best-effort; the in-memory selection already applied.
  }
}

/**
 * Logout cleanup: drop the persisted active taster for the current account and
 * reset to the self default. Prefer setActiveTasterUser(null) for normal switch.
 */
export async function clearActiveTaster(): Promise<void> {
  const key = storageKey(userId)
  active = null
  emit()
  try {
    await AsyncStorage.removeItem(key)
  } catch {
    // best-effort
  }
}

// ----------------------------------------------------------------
// Hook
// ----------------------------------------------------------------

/** Subscribe to the active taster id (null = self default). */
export function useActiveTaster(): string | null {
  const [value, setValue] = useState<string | null>(() => active)
  const mounted = useRef(false)

  useEffect(() => {
    mounted.current = true
    const listener: Listener = (next) => {
      if (mounted.current) setValue(next)
    }
    listeners.add(listener)
    // Paint the current value on mount, then hydrate the persisted choice in
    // case this is a cold start (nothing loaded yet).
    setValue(active)
    void hydrate()
    return () => {
      mounted.current = false
      listeners.delete(listener)
    }
  }, [])

  return value
}
