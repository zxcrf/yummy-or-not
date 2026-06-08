/* Add tab — thin route wrapper around components/app/AddModal.
   Reached via the center FAB (narrow) or the "Log a taste" CTA (wide).
   On close → back to Library; on save → open the new taste's detail. */
import { router } from 'expo-router'

import AddModal from '@/components/app/AddModal'
import { Screen } from './_screen'

export default function AddRoute() {
  return (
    <Screen>
      <AddModal
        onClose={() => router.navigate('/(tabs)')}
        onSaved={(id) => router.replace(`/taste/${id}`)}
      />
    </Screen>
  )
}
