/* ============================================================
   YUMMY OR NOT — password-reset token parsing (shared)

   ONE parser, TWO entry points on mobile: the deep-link URL
   (`yummyornot://reset-password?token=…`) and the clipboard string a
   user pastes after copying from an email opened on another device
   (desktop/web mail can't launch the app, so copy-paste is the bridge).

   The email carries a 256-bit hex token both as a tappable deep link AND
   as copyable text, so extractResetToken accepts either the full URL or
   the bare token. Anything else returns null — callers must NOT act on
   unrecognized clipboard text (privacy: never treat arbitrary text as a
   reset code).
   ============================================================ */

/** Deep-link / web path that carries a reset token. */
export const RESET_PATH = "reset-password";

/** A raw reset token is exactly 64 hex chars (256-bit, generateResetToken). */
const BARE_TOKEN_RE = /^[0-9a-fA-F]{64}$/;

/** Match the reset deep/web link and capture its `token` query param. We avoid
 *  the URL parser (the custom `yummyornot://` scheme isn't reliably parsed by
 *  URL on every RN engine) and instead require `reset-password` to be a real
 *  PATH segment (preceded by `//` or `/`) immediately followed by its query —
 *  so a foreign link that merely MENTIONS `reset-password` in a param value
 *  (e.g. `…/import?next=reset-password&token=…`) does NOT match. The token must
 *  itself be a proper query param ending at a delimiter or end-of-string. */
const RESET_URL_RE = /(?:\/\/|\/)reset-password\?(?:[^#]*&)?token=([0-9a-fA-F]{64})(?:[&#]|$)/i;

/**
 * Extract a reset token from a deep-link URL, a web URL, or a bare token.
 * Returns null for anything that is not a recognizable reset token so the
 * caller can safely ignore unrelated clipboard contents.
 *
 *   yummyornot://reset-password?token=<hex>   → <hex>
 *   https://host/reset-password?token=<hex>    → <hex>
 *   <64-hex>                                    → <64-hex>
 *   anything else                               → null
 */
export function extractResetToken(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Bare token pasted directly.
  if (BARE_TOKEN_RE.test(trimmed)) return trimmed;

  const m = RESET_URL_RE.exec(trimmed);
  return m ? m[1] : null;
}

/** Build the reset deep link the email links to. Mobile-only: this opens the
 *  app straight to the new-password step with the token prefilled. */
export function resetDeepLink(token: string): string {
  return `yummyornot://${RESET_PATH}?token=${token}`;
}
