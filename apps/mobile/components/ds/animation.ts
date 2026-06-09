// Tamagui v2 styled() strips the `animation` prop from TypeScript types.
// These pre-cast objects let DS components spread animation without per-site `as any`.
export const bouncy = { animation: 'bouncy' } as Record<string, unknown>
export const quick = { animation: 'quick' } as Record<string, unknown>
