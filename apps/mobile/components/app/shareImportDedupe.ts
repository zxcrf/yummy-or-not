/* ============================================================
   YUMMY OR NOT — share-import dedupe marker (S3a 可导入)

   The foreground clipboard auto-detect (useShareTokenImport) and the SENDER's
   own importable-share flow (DetailView.handleShareImportable) both touch the
   SAME persisted marker:

   • useShareTokenImport reads it so the SAME 口令 never re-prompts a recipient.
   • handleShareImportable writes it right after minting a share, so the SENDER
     is never auto-prompted to import their OWN freshly-shared code (which would
     copy-on-import a duplicate of their own taste — there is no server-side
     self-import guard).

   Kept in its own module (not on the hook) so DetailView can mark a code
   handled without importing the hook's AppState/clipboard machinery.
   ============================================================ */

// AsyncStorage key holding the last importCode we already handled (dedupe).
const LAST_HANDLED_KEY = '@yon/share-import:last-handled-code'

function getAsyncStorage(): typeof import('@react-native-async-storage/async-storage').default {
  // The real package exposes the API on `.default`; the jest mock exports it at
  // the module top level. Normalize so both production and tests resolve the
  // same getItem/setItem surface.
  const mod = require('@react-native-async-storage/async-storage')
  return mod.default ?? mod
}

/** The import code already handled (recipient-imported or sender-minted), or
 *  null. Swallows storage errors → null (a failed read just means "not deduped",
 *  the safe default for a background clipboard sniff). */
export async function readHandledShareCode(): Promise<string | null> {
  try {
    return (await getAsyncStorage().getItem(LAST_HANDLED_KEY)) ?? null
  } catch {
    return null
  }
}

/** Persist an import code as already-handled. Called on a successful recipient
 *  resolve AND on the sender's device right after minting an importable share
 *  (the self-import guard). Storage errors are swallowed — a missed write only
 *  means the code may prompt once, never a crash. */
export async function markShareCodeHandled(code: string): Promise<void> {
  try {
    await getAsyncStorage().setItem(LAST_HANDLED_KEY, code)
  } catch {
    // best-effort
  }
}
