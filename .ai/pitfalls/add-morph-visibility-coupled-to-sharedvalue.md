# Add-screen morph strands because form visibility is coupled to a reanimated SharedValue

**Date:** 2026-06-18 · **Issues:** #46 → #55 → #125 → #126 → #154 (survived 5 targeted fixes) · diagnosed via on-device `[MORPH]` logcat overlay (diag/add-morph-logging).

## Symptom
After adding a taste and picking/cropping a photo, the Add screen strands:
either a frozen FAB-sized circle artifact over the Library list, or a cream
blank, or the underlying Library showing through with the form gone. Intermittent,
device-only (never reproduces in jest because jest never recreates the Activity).

## Root cause (PROVEN by runtime log, not guessed)
The `[MORPH]` timeline showed the entrance morph reaching `p=1.0` perfectly, then
the Android crop activity returns through an **Activity recreation** (a 44ms
`background→active→background→active` AppState bounce). After recreation, **JS
still holds `progress=1.0` (logs: `assertOpen(appstate) BAIL open p=1.00`) but the
native reanimated view no longer follows it** — the UI-thread view detached/desynced
from the JS SharedValue.

The Add screen (`app/add.tsx`) rendered `<AddModal>` *inside* the morph container
whose width/height/opacity were `interpolate(progress.value, …)`. So the form's very
visibility depended on `progress` staying synced. When recreation desynced it, the
form vanished — and **no amount of re-writing `progress.value = 1` fixes it** (the
native view ignores the write). That is exactly why every prior fix (#125 backstop,
#154 deterministic mount trigger, AppState/focus re-arms) failed: they all targeted
"make the OPEN trigger fire / write progress=1", but the failure is in the native↔JS
bridge across Activity recreation, not in whether the trigger fired.

## Fix (structural — decouple visibility from animation)
- Render `<AddModal>` in a **plain, always-opaque, full-screen layer whose
  visibility is a function of a plain React `phase` state, NOT of `progress`.**
  Once `phase==='open'` it is a pure RN view — survives Activity recreation like any
  normal screen; no SharedValue can hide it.
- Demote the morph to a **transient entrance/exit overlay** that is removed by a
  plain `setTimeout` (NOT the animation-completion callback, which the recreation
  storm can swallow). A stranded/preempted overlay self-clears on the timer, so it
  can never persist over the screen.
- Result: the entire fragile open-trigger surface (assertOpen / focus arm / AppState
  arm / open backstop) is deleted — open-animation reliability becomes irrelevant
  because it no longer holds the screen.
- Defense-in-depth: wrap `<AddModal>` in an error boundary so any render throw shows
  text instead of a blank (covers the secondary render-throw hypothesis).

## Prevention
Never gate a screen's *visibility/presence* on a reanimated SharedValue that must
survive an Android Activity recreation (camera, image crop, share sheet all trigger
it). Animations may be driven by SharedValues; **the steady, visible state must be a
plain view backed by React state.** Timers (JS) survive recreation; animation
callbacks and native↔JS shared-value sync do not.
