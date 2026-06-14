/* ============================================================
   YUMMY OR NOT — useResetTokenCapture

   The reset email links to `yummyornot://reset-password?token=…`. When the
   user taps it ON THE PHONE the app opens here (cold or warm); expo-linking's
   useURL() hands us that URL. We parse the token with the SAME shared
   extractResetToken used by the manual clipboard-paste path, so deep link and
   paste converge on one parser.

   The reset arrives while SIGNED OUT (AppGate shows AuthScreen, not the Stack
   routes), so unlike the share-import deep link we cannot route to a Stack
   screen — AuthScreen consumes the returned token into its own state and jumps
   straight to the new-password step.
   ============================================================ */
import { useLinkingURL } from 'expo-linking'
import { extractResetToken } from '@yon/shared'

/** The reset token carried by the current deep-link URL, or null when the app
 *  wasn't opened from a reset link. Pure read of expo-linking's URL → no
 *  clipboard read here (so no iOS paste toast); the clipboard path is an
 *  explicit user action in the form. */
export function useResetTokenCapture(): string | null {
  const url = useLinkingURL()
  return extractResetToken(url)
}
