/* Library tab — thin route wrapper around components/app/LibraryView.

   The page header (CENTERED title-dropdown + top-right taster avatar) is
   owned by LibraryView via the shared PageHeader; this route only injects
   the avatar (TasterSwitcher) into the header's right slot. The active
   taster is confirmed by that avatar — there is no separate "正在查看 X 的
   口味" banner. */

import LibraryView from '@/components/app/LibraryView'
import TasterSwitcher from '@/components/app/TasterSwitcher'
import { Screen } from './_screen'

export default function LibraryRoute() {
  return (
    <Screen>
      <LibraryView headerRight={<TasterSwitcher />} />
    </Screen>
  )
}
