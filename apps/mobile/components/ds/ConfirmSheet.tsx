/* ============================================================
   YUMMY OR NOT — ConfirmSheet (plain RN + theme)

   A shared dim-overlay bottom-sheet confirm dialog.
   Implemented as an absolute-positioned overlay View (NOT a
   React Native Modal) so it works safely inside editors that
   are themselves RN Modals — nested Modals are flaky on Android.

   Visuals mirror AddModal's sheetStyles and DetailView's
   sheetOverlay/sheetContent patterns.

   Dismiss path: tap the dim overlay. Confirm path: tap the
   single primary button. No secondary button — dim-tap IS the
   keep-editing action.
   ============================================================ */

import { Pressable, StyleSheet, View } from 'react-native'
import { Text } from '@/theme'
import { Button } from './Button'

// ---------- Public types ----------

export type ConfirmSheetProps = {
  visible: boolean
  title: string
  body?: string
  confirmLabel: string
  onConfirm: () => void
  onDismiss: () => void
  /** true → red confirm button (#ff3147) */
  destructive?: boolean
  testID?: string
}

// ---------- Component ----------

export function ConfirmSheet({
  visible,
  title,
  body,
  confirmLabel,
  onConfirm,
  onDismiss,
  destructive,
  testID,
}: ConfirmSheetProps) {
  if (!visible) return null

  return (
    /* Outer Pressable: dim overlay — tap to dismiss (keep editing) */
    <Pressable
      style={[StyleSheet.absoluteFill, styles.overlay]}
      onPress={onDismiss}
      testID={testID}
    >
      {/* Inner Pressable: white sheet — stops tap propagation to overlay */}
      <Pressable style={styles.sheet} onPress={() => {}}>
        <Text
          style={{ color: '#191017', fontWeight: '700', fontSize: 18, marginBottom: 8 }}
        >
          {title}
        </Text>

        {body != null && (
          <Text style={{ color: '#7a7080', fontSize: 15, marginBottom: 20 }}>
            {body}
          </Text>
        )}

        <View style={{ alignItems: 'flex-end' }}>
          <Button
            variant="primary"
            onPress={onConfirm}
            testID={testID != null ? `${testID}-confirm` : undefined}
            style={destructive ? { backgroundColor: '#ff3147' } : undefined}
          >
            {confirmLabel}
          </Button>
        </View>
      </Pressable>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  overlay: {
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 24,
    paddingBottom: 40,
  },
})

export default ConfirmSheet
