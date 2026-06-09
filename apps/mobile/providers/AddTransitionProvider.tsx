import { createContext, useContext } from 'react'
import { useSharedValue, type SharedValue } from 'react-native-reanimated'

export interface FabLayout {
  x: number
  y: number
  width: number
  height: number
}

interface AddTransitionCtx {
  fabLayout: SharedValue<FabLayout | null>
}

const Ctx = createContext<AddTransitionCtx | null>(null)

export function AddTransitionProvider({ children }: { children: React.ReactNode }) {
  const fabLayout = useSharedValue<FabLayout | null>(null)
  return <Ctx.Provider value={{ fabLayout }}>{children}</Ctx.Provider>
}

export function useAddTransition() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useAddTransition must be inside AddTransitionProvider')
  return ctx
}
