/* You tab — thin route wrapper around components/app/YouView. */
import YouView from '@/components/app/YouView'
import { Screen } from './_screen'
import { useTastes } from './_useTastes'

export default function YouRoute() {
  const items = useTastes()
  return (
    <Screen>
      <YouView items={items} />
    </Screen>
  )
}
