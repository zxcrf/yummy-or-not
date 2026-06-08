/* Library tab — thin route wrapper around components/app/LibraryView. */
import LibraryView from '@/components/app/LibraryView'
import { Screen } from './_screen'

export default function LibraryRoute() {
  return (
    <Screen>
      <LibraryView />
    </Screen>
  )
}
