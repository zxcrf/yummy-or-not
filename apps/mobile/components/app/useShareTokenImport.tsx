/* ============================================================
   YUMMY OR NOT — useShareTokenImport (S3a 可导入 foreground auto-detect)

   Friendly import: instead of forcing the recipient to eyeball-type the import
   code, this hook watches for the app coming to the foreground and reads the
   clipboard ONCE. If the clipboard holds a real 口令 (encodeShareToken-wrapped
   importCode — NOT ordinary text), it resolves the EXISTING importCode → a live
   token via the existing /api/share/resolve endpoint and routes to the import
   landing (which previews + confirms before saving anything).

   Privacy / UX rules baked in:
   • Acts ONLY on a real 口令 match (parseShareToken returns non-null). Ordinary
     clipboard text is ignored — no resolve, no navigation.
   • Reads the clipboard ONCE per foreground (no polling). iOS surfaces a paste
     toast on read, so we read minimally and only on the active transition.
   • DEDUPE: the last-handled importCode is persisted (AsyncStorage). The SAME
     口令 never re-prompts on a later foreground — the recipient is not nagged.
   ============================================================ */

import { useEffect, useRef } from 'react'
import { AppState, type AppStateStatus } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import { useRouter } from 'expo-router'
import { parseShareToken, resolveImportCode } from '@yon/shared'

import { useAuth } from '@/providers/AuthProvider'

// AsyncStorage key holding the last importCode we already handled (dedupe).
const LAST_HANDLED_KEY = '@yon/share-import:last-handled-code'

function getAsyncStorage(): typeof import('@react-native-async-storage/async-storage').default {
  // The real package exposes the API on `.default`; the jest mock exports it at
  // the module top level. Normalize so both production and tests resolve the
  // same getItem/setItem surface.
  const mod = require('@react-native-async-storage/async-storage')
  return mod.default ?? mod
}

/**
 * useShareTokenImport — mounted in AppGate (which renders for loading /
 * unauthenticated states too). The clipboard read + resolve are only meaningful
 * for a signed-in user: the import landing needs a session, and an
 * unauthenticated resolve/import would 401. On iOS each AppState 'active' read
 * also surfaces a system paste-permission toast, so we must NOT register the
 * AppState subscription at all until there is a user. We therefore gate on the
 * auth `user`: while it is null (loading or signed-out) the hook is fully inert
 * (no subscription, no clipboard read). When the user appears the effect
 * re-runs and the subscription is registered for the signed-in lifetime.
 *
 * On every foreground transition it checks the clipboard for a 口令 and, on a
 * fresh hit, routes to the import landing for the resolved token.
 */
export function useShareTokenImport(): void {
  const router = useRouter()
  const { user } = useAuth()
  // Last-handled importCode held in-memory for the dedupe check. Hydrated from
  // AsyncStorage on mount and updated synchronously when we handle a code, so
  // the foreground hot path needs only the single clipboard read (no extra
  // await before resolve, and no re-prompt for an already-handled code).
  const lastHandledRef = useRef<string | null>(null)
  // In-flight guard so two rapid 'active' transitions don't double-resolve the
  // same code before lastHandledRef is set.
  const handlingRef = useRef(false)

  useEffect(() => {
    // Inert until signed in: no AppState subscription, no clipboard read (so an
    // unauthenticated/loading session never triggers the iOS paste toast or a
    // 401 resolve). The effect re-runs once `user` becomes non-null.
    if (!user) return

    let alive = true

    // Hydrate the dedupe marker so a code handled in a PREVIOUS app session is
    // not re-prompted after a cold start.
    void getAsyncStorage()
      .getItem(LAST_HANDLED_KEY)
      .then((stored) => {
        if (alive && stored && lastHandledRef.current == null) {
          lastHandledRef.current = stored
        }
      })
      .catch(() => {})

    const handleForeground = async () => {
      if (handlingRef.current) return
      handlingRef.current = true
      try {
        const text = await Clipboard.getStringAsync()
        if (!alive) return
        const code = parseShareToken(text)
        // Not a 口令 → ignore entirely (privacy: never act on ordinary text).
        if (!code) return
        // DEDUPE: same code already handled → never re-prompt.
        if (lastHandledRef.current === code) return

        // Resolve FIRST. The in-flight `handlingRef` guard (set above, cleared
        // in finally) already prevents a concurrent 'active' from double-firing
        // the same code mid-resolve, so we don't need the dedupe marker to do
        // that. Critically, we must NOT persist the dedupe marker before the
        // resolve: an expired token answers 404, and marking it handled here
        // would permanently dedupe the importCode — a later fresh token sharing
        // the same code could never auto-import. So mark handled only AFTER a
        // successful resolve.
        const { token } = await resolveImportCode(code)
        if (!alive) return

        // Resolve succeeded → NOW persist the dedupe marker so the SAME live
        // 口令 won't re-prompt on a later foreground. (On a 404 we fall through
        // to catch and leave lastHandledRef unset, so the user can retry once
        // the sender reshares a fresh token.)
        lastHandledRef.current = code
        void getAsyncStorage()
          .setItem(LAST_HANDLED_KEY, code)
          .catch(() => {})

        router.push(`/import/${token}`)
      } catch {
        // 404 (expired token) / resolve failure / clipboard read error → do
        // nothing and, crucially, leave lastHandledRef UNSET so a later fresh
        // token under the same importCode can still be auto-imported. We never
        // surface an error toast from a background clipboard sniff.
      } finally {
        handlingRef.current = false
      }
    }

    const subscription = AppState.addEventListener(
      'change',
      (state: AppStateStatus) => {
        if (state === 'active') void handleForeground()
      },
    )

    return () => {
      alive = false
      subscription.remove()
    }
  }, [router, user])
}
