/* ============================================================
   YUMMY OR NOT — recall tab route shell
   Thin wrapper: mounts RecallView inside the shared Screen chrome and
   injects the taster avatar into RecallView's PageHeader right slot
   (same CENTERED-title + top-right-avatar treatment as the Library tab).
   ============================================================ */

import { Screen } from './_screen'
import RecallView from '@/components/app/RecallView'
import TasterSwitcher from '@/components/app/TasterSwitcher'

export default function RecallTab() {
  return (
    <Screen>
      <RecallView headerRight={<TasterSwitcher />} />
    </Screen>
  )
}
