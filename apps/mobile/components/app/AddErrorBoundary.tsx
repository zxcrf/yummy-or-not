/* ============================================================
   AddErrorBoundary — defense-in-depth for the Add screen.

   The Add screen used to go BLANK (no visible error) when <AddModal>
   threw during render on an Android crop-return / activity-recreation
   remount, because nothing wrapped it in a React error boundary — the
   subtree silently vanished, leaving the route's cream background.

   This boundary renders the error text instead of going blank, so a
   render throw is (a) survivable — the user gets a Close button instead
   of a dead screen — and (b) diagnosable — the message is on screen.

   It is intentionally tiny and dependency-free (no theme/i18n imports)
   so the boundary itself cannot throw while handling another throw.
   ============================================================ */

import { Component, type ReactNode } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'

interface Props {
  children: ReactNode
  /** Called when the user dismisses the error screen (route should close). */
  onClose: () => void
}

interface State {
  error: Error | null
}

export class AddErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <View
        style={{
          flex: 1,
          backgroundColor: '#fff6e6',
          paddingHorizontal: 24,
          paddingTop: 80,
          gap: 16,
        }}
      >
        <Text style={{ fontSize: 18, fontWeight: '700', color: '#191017' }}>
          出错了
        </Text>
        <ScrollView style={{ flex: 1 }}>
          <Text style={{ fontSize: 13, color: '#5b4b53' }}>
            {error.message || String(error)}
          </Text>
        </ScrollView>
        <Pressable
          accessibilityRole="button"
          onPress={this.props.onClose}
          style={{
            alignSelf: 'flex-start',
            backgroundColor: '#ff2e88',
            borderWidth: 3,
            borderColor: '#191017',
            borderRadius: 12,
            paddingVertical: 12,
            paddingHorizontal: 24,
          }}
        >
          <Text style={{ color: '#fff', fontWeight: '700' }}>关闭</Text>
        </Pressable>
      </View>
    )
  }
}

export default AddErrorBoundary
