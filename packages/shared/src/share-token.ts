/* ----------------------------------------------------------------
   S3a 可导入 (淘口令) share-token codec.

   The 可导入 share mode copies a 口令 (passphrase) string to the clipboard and
   into the system share text. The 口令 wraps the EXISTING mintShare importCode
   in collision-resistant delimiters so that:

     • a human can read the code off the card / text as a last resort, and
     • the app's foreground auto-detect can parse it back out of whatever the
       user happened to copy — WITHOUT acting on ordinary clipboard text.

   This reuses the importCode space. It does NOT mint a new code: encode wraps
   the code verbatim, parse returns it verbatim.

   Format:  【YON口令】<importCode>【/YON】

   Why these delimiters: the CJK-bracketed 【YON口令】 / 【/YON】 markers are
   collision-resistant (they essentially never appear by accident in ordinary
   clipboard text or URLs), survive copy/paste through WeChat / 小红书 verbatim,
   and are regex-parseable even when other text abuts them. A bare code with no
   wrapper is deliberately rejected so a random 6-char string copied by chance
   never triggers an import (privacy: only act on a real match).
   ---------------------------------------------------------------- */

const OPEN = "【YON口令】";
const CLOSE = "【/YON】";

// The wrapped payload (the importCode) — any run of non-bracket chars between
// the markers. Lazy so the FIRST closing marker terminates the capture.
const TOKEN_RE = /【YON口令】([^【】]+)【\/YON】/;

/**
 * encodeShareToken — wrap an existing importCode in the 口令 delimiters.
 * The code is embedded verbatim (no transform / re-encode).
 */
export function encodeShareToken(importCode: string): string {
  return `${OPEN}${importCode}${CLOSE}`;
}

/**
 * parseShareToken — extract the wrapped importCode from arbitrary clipboard /
 * share text, or null when no 口令 pattern is present.
 *
 * Tolerates surrounding words, whitespace, newlines, and text that directly
 * abuts the delimiters. Returns null for empty input, ordinary text, a bare
 * code with no wrapper, or a malformed half-token (only one delimiter).
 */
export function parseShareToken(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = TOKEN_RE.exec(text);
  return m ? m[1] : null;
}
