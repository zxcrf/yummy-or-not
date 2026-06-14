/* ============================================================
   YUMMY OR NOT — share-import dedupe store (S3a 可导入)

   The foreground clipboard auto-detect (useShareTokenImport) and the SENDER's
   own importable-share flow (DetailView.handleShareImportable) both record
   import codes into the SAME persisted store:

   • useShareTokenImport records a code after a successful resolve so the SAME
     口令 never re-prompts a recipient.
   • handleShareImportable records the freshly-minted code so the SENDER is never
     auto-prompted to import their OWN share (which would copy-on-import a
     duplicate of their own taste — the import API has no self-import guard).

   Stored as a bounded SET (not a single slot): the recipient and sender paths
   must not evict each other. With a single slot, "import X then share Y" drops
   X — and worse, "share Y then import X" drops Y, so the sender's own code Y
   could later self-import (the very bug this module exists to prevent). A small
   capped set keeps every recently-handled code so both guards hold together.

   Kept in its own module (not on the hook) so DetailView can record a code
   without importing the hook's AppState/clipboard machinery.
   ============================================================ */

// AsyncStorage key holding the set of import codes already handled (dedupe).
const HANDLED_KEY = '@yon/share-import:handled-codes'
// Cap the persisted set so it can't grow without bound. Codes are only ever
// handled on a real share/import, so this is generous; oldest fall off first.
const MAX_HANDLED = 50

function getAsyncStorage(): typeof import('@react-native-async-storage/async-storage').default {
  // The real package exposes the API on `.default`; the jest mock exports it at
  // the module top level. Normalize so both production and tests resolve the
  // same getItem/setItem surface.
  const mod = require('@react-native-async-storage/async-storage')
  return mod.default ?? mod
}

/** The set of import codes already handled (recipient-imported or sender-minted),
 *  newest last. Swallows storage / parse errors → [] (a failed read just means
 *  "not deduped", the safe default for a background clipboard sniff). */
export async function readHandledShareCodes(): Promise<string[]> {
  try {
    const raw = await getAsyncStorage().getItem(HANDLED_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

/** True when `code` is already in the handled set. */
export async function isShareCodeHandled(code: string): Promise<boolean> {
  return (await readHandledShareCodes()).includes(code)
}

/** Add an import code to the handled set. Called on a successful recipient
 *  resolve AND on the sender's device right after minting an importable share
 *  (the self-import guard). Storage errors are swallowed — a missed write only
 *  means the code may prompt once, never a crash. */
export async function markShareCodeHandled(code: string): Promise<void> {
  try {
    const codes = await readHandledShareCodes()
    if (codes.includes(code)) return
    codes.push(code)
    // Keep only the most-recent MAX_HANDLED (oldest fall off the front).
    const capped = codes.slice(-MAX_HANDLED)
    await getAsyncStorage().setItem(HANDLED_KEY, JSON.stringify(capped))
  } catch {
    // best-effort
  }
}
