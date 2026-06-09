# Material Motion — Animation Design Document

## Overview

All interactive elements in the app follow Android Material Design 3 Motion patterns. Every user-tappable element has animated feedback — no instant snaps.

## Motion Patterns Applied

### State Layer (press/focus feedback)

Tamagui animation driver (`@tamagui/animations-react-native`) provides spring-based transitions for all `pressStyle` and `focusStyle` on DS components.

**Presets:**
- `bouncy` — damping 9, stiffness 150, mass 0.9 (buttons, verdict picker)
- `quick` — damping 20, stiffness 250 (cards, tags, inputs, lang switcher)
- `lazy` — damping 15, stiffness 100 (reserved for large surface transitions)
- `100ms` / `200ms` — timing-based for non-spring use cases

**Components with press animation:**

| Component | Animation | Effect |
|---|---|---|
| Button | bouncy | x/y translate into pop-shadow |
| IconButton | bouncy | x/y translate into pop-shadow |
| Card (interactive) | quick | x/y translate + shadow collapse |
| Tag (clickable) | quick | scale 0.92 + opacity 0.85 |
| VerdictPicker option | bouncy | scale 0.95 |
| FoodCard (tappable) | quick | scale 0.98 + shadow collapse |
| LangSwitcher trigger | quick | scale 0.95 + opacity 0.85 |
| AuthScreen MethodTab | quick | scale 0.95 + opacity 0.8 |

**Components with focus animation:**

| Component | Effect |
|---|---|
| Input (Web/iOS) | smooth focus shadow appearance |
| Textarea (Web/iOS) | smooth focus shadow appearance |

### Micro-interactions (react-native-reanimated)

| Element | Animation | Detail |
|---|---|---|
| Switch knob | `withSpring` translateX | damping 15, stiffness 200; knob slides 1→27px |
| Tab bar icon | `withSpring` scale | active: 1→1.18, inactive: 1.18→1 |
| FAB (+) | `withSpring` scale | pressIn: 1→0.85, pressOut: 0.85→1 |

### Fade Through / Fade (entering/exiting)

| Element | Entering | Exiting |
|---|---|---|
| LangSwitcher dropdown (native) | FadeIn 150ms | FadeOut 100ms |
| AddModal error message | FadeIn 200ms | FadeOut 150ms |
| AuthScreen error banner | FadeIn 200ms | FadeOut 150ms |

### Container Transform

**FAB → Add modal** — the signature Material Motion transition.

Architecture: "Add" is a root Stack modal (`presentation: 'transparentModal'`) instead of a tab screen. The FAB measures its screen position via `measureInWindow`, stores coordinates in `AddTransitionProvider` context, then navigates to `/add`.

The modal renders:
1. Expanding circle (`Animated.View`, borderRadius from pill to maxRadius) starting from FAB position
2. Background overlay fading to `$background`
3. Content (`AddModal`) fading in after 220ms delay

Close/save reverse: content fades out → circle contracts → `router.back()` or `router.replace('/taste/:id')`.

Spring config: damping 18, stiffness 160. Expand duration ~380ms.

Fallback: if FAB measurement fails, defaults to bottom-center of screen.

## Architecture Decisions

1. **Tamagui animation driver over manual reanimated for press feedback** — one config change animates all existing pressStyle/focusStyle. Minimal code, maximum coverage.

2. **Typed animation helpers** — Tamagui v2 `styled()` strips the `animation` prop from TypeScript types. `components/ds/animation.ts` exports pre-typed `bouncy` and `quick` objects that components spread, avoiding per-callsite `as any` casts.

3. **"Add" moved from tab to root modal** — Container Transform requires the source (FAB) to morph into the destination. Tab transitions don't support this. The FAB already handled navigation separately from normal tabs.

4. **Switch uses reanimated directly instead of Tamagui animation** — the knob needs translateX interpolation, which Tamagui's spring system can't express (it only animates style properties set in pressStyle/focusStyle).

5. **Track color stays instant** — Material Design switch also changes track color instantly; the knob sliding is the primary animation signal.

## Dependencies

- `@tamagui/animations-react-native` ^2.1.0 (added to mobile package.json)
- `react-native-reanimated` 4.3.1 (already installed, now actively used)

## Files Changed

| File | Layer | What changed |
|---|---|---|
| `tamagui.config.ts` | Config | +animations driver with 5 presets |
| `Button.tsx` | L1 | +animation="bouncy" on Frame |
| `IconButton.tsx` | L1 | +animation="bouncy" on Frame |
| `Card.tsx` | L1 | +animation="quick" when interactive |
| `Tag.tsx` | L1 | +pressStyle (scale+opacity) + animation |
| `VerdictPicker.tsx` | L1 | +pressStyle (scale) + animation |
| `FoodCard.tsx` | L1 | +pressStyle (scale+shadow) + animation |
| `Input.tsx` | L1 | +animation="quick" on Field |
| `Textarea.tsx` | L1 | +animation="quick" on Field |
| `LangSwitcher.tsx` | L1+L3 | +pressStyle + animation + FadeIn/Out dropdown |
| `Switch.tsx` | L2 | Rewritten: reanimated knob slide |
| `_nav.tsx` | L2+L4 | AnimatedTab + AnimatedFab + FAB measurement |
| `AuthScreen.tsx` | L2+L3 | MethodTab press + error FadeIn |
| `AddModal.tsx` | L3 | Error message FadeIn |
| `_layout.tsx` (root) | L4 | +AddTransitionProvider + add modal route |
| `_layout.tsx` (tabs) | L4 | add tab hidden (href: null) |
| `add.tsx` (root, new) | L4 | Container Transform animation wrapper |
| `AddTransitionProvider.tsx` (new) | L4 | FAB coordinate context |
| `package.json` | Dep | +@tamagui/animations-react-native |

## Known Issues

- `runOnJS` deprecated in reanimated 4.x — still functional, replacement API TBD.
- Android elevation doesn't support animated shadowOffset — pop-shadow press animations are iOS/web only; Android still gets x/y translate.
