/* Stats tab — thin route wrapper around components/app/StatsView.
   StatsView takes `items`; the wrapper fetches the taste list. */
import StatsView from '@/components/app/StatsView'
import { Screen } from './_screen'
import { useTastes } from './_useTastes'

export default function StatsRoute() {
  const items = useTastes()
  return (
    <Screen>
      <StatsView items={items} />
    </Screen>
  )
}
