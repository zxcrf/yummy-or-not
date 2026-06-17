/* ============================================================
   YUMMY OR NOT — recall tab route shell
   Thin wrapper: mounts RecallView inside the shared Screen chrome.
   ============================================================ */

import { Screen } from './_screen'
import RecallView from '@/components/app/RecallView'

export default function RecallTab() {
  return (
    <Screen>
      <RecallView />
    </Screen>
  )
}
