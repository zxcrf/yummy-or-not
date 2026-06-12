/* To-Try (想吃) tab — thin route wrapper around components/app/TodoView. */
import TodoView from '@/components/app/TodoView'
import { Screen } from './_screen'

export default function TodoRoute() {
  return (
    <Screen>
      <TodoView />
    </Screen>
  )
}
