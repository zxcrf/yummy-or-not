/* Library tab — thin route wrapper around components/app/LibraryView.
   The taster switcher (S3b) sits atop the library; it self-hides for free
   accounts, so it only adds a persona row for pro users. */
import LibraryView from '@/components/app/LibraryView'
import TasterSwitcher from '@/components/app/TasterSwitcher'
import { Screen } from './_screen'

export default function LibraryRoute() {
  return (
    <Screen>
      <TasterSwitcher />
      <LibraryView />
    </Screen>
  )
}
