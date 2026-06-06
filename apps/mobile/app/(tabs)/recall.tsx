/* Recall tab — thin route wrapper around components/app/RecallView. */
import RecallView from '@/components/app/RecallView'
import { Screen } from './_screen'

export default function RecallRoute() {
  return (
    <Screen>
      <RecallView />
    </Screen>
  )
}
