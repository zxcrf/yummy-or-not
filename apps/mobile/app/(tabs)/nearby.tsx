/* Nearby tab — thin route wrapper around components/app/NearbyHeatView.
   "附近 · 热力" AMap heatmap. The view owns the AMap privacy-consent gate,
   the default-locate-on-entry, and the native MapView; the route only frames
   it. As a tab (not a root pushed card) Android hardware back returns to the
   previous tab instead of exiting the app. */
import NearbyHeatView from '@/components/app/NearbyHeatView'
import { Screen } from './_screen'

export default function NearbyRoute() {
  return (
    <Screen>
      <NearbyHeatView />
    </Screen>
  )
}
