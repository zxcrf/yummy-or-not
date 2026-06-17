# ADR 0001 — Unified EditActionHeader top action bar

- Status: proposed
- Date: 2026-06-16

## Context

Save/cancel placement is inconsistent across editable and command screens.
Fullscreen/route screens put the primary action in a bottom sticky footer that
rides the keyboard (keyboard-ux.md rule #4, PR #68), while bottom sheets put
controls elsewhere. Users hit a different "where is save?" muscle-memory per
screen. The AddModal pattern also loses usable viewport: a keyboard-riding
bottom footer plus an on-screen keyboard squeezes the editable content area,
and on short screens the footer competes with the field+cursor for the space
above the keyboard.

## Decision

Introduce ONE shared `EditActionHeader` (apps/mobile/components/ds) used by
every editable/command screen. Layout is a fixed 3-slot top bar:

- 取消 (cancel) LEFT
- title CENTER (absolute, pointerEvents-none layer so it stays centered
  regardless of unequal left/right widths and never eats side-button taps)
- primary command RIGHT (save / 查找 / import — label + optional icon vary)

It has two variants:

- `screen` — top of a fullscreen route: safe-area top inset + 3px bottom border.
- `sheet` — top of a bottom sheet: no inset, no bottom border.

> **Superseded 2026-06-17 — see Amendment below.** The `sheet` variant was
> removed; all five edit forms are now full-screen and use the `screen` layout
> exclusively.

This **supersedes keyboard-ux.md rule #4 ("主操作按钮做 sticky footer，跟随 ime
inset")** for FULLSCREEN / ROUTE screens: those drop the bottom sticky footer
entirely and surface the primary command in the top bar, which never overlaps
the keyboard and reclaims the viewport.

SHEETS keep their command inside the `KeyboardStickyView` subtree: the
EditActionHeader sits at the top of the sheet content INSIDE the keyboard-sticky
container so the whole sheet (and therefore its action row) still rides above
the keyboard.

## Consequences

- Consistent save/cancel location everywhere; one component to test and theme.
- Fullscreen screens no longer need a keyboard-riding footer → simpler keyboard
  handling, more usable viewport on short screens.
- keyboard-ux.md rule #4 is now scoped to sheets only; documented via an
  amendment referencing this ADR.
- Callers must migrate their existing footer save/cancel to the header; primary
  `testID` is a prop so existing test selectors keep working.

## Alternatives considered

- **Keep per-screen footers (status quo).** Rejected: inconsistent placement,
  viewport loss, duplicated keyboard plumbing.
- **Header for routes, footer for sheets, no shared component.** Rejected: two
  implementations drift; the shared component already serves both via `variant`.
- **Bottom action bar everywhere.** Rejected: still rides/competes with the
  keyboard on fullscreen edit screens, which is the core problem.

## Amendment 2026-06-17 — drop the `sheet` variant; all editors full-screen

The original decision shipped two layouts (`screen` + `sheet`). In practice the
two looked and behaved differently enough (a bottom sheet glued to the keyboard
vs. a full page glued to the safe-area top) that the "same place every time"
goal was only half met, and the `sheet` path also surfaced a title-alignment bug
(the absolute title layer spanned `top:0,bottom:0`, floating the title up into
the status-bar pad on `screen`).

**Revised decision:** there is ONE layout. The `variant` prop is removed; the
component always renders the former `screen` style (safe-area top inset + 3px
bottom border), and the title layer is centered on the cancel/primary centerline
(`top: insets.top+12`, `bottom: 12`). The three remaining bottom-sheet editors
(编辑昵称 / 家人 / 标签重命名) are converted to full-screen `Modal`s using the
AddModal pattern (pinned `EditActionHeader` + `KeyboardAwareScrollView`), so
`KeyboardStickyView` is no longer used by any edit form.

**Consequence for keyboard-ux.md rule #4:** it no longer applies to *any* edit
form — every edit form now uses the top action bar (which never overlaps the
keyboard), not a keyboard-riding sticky footer. The "sheets keep the command
inside `KeyboardStickyView`" carve-out above is void.

**Related:** a shared `ConfirmSheet` (absolute-overlay View, not a nested Modal)
now guards cancel-when-dirty on every edit form. Status remains `proposed` —
this amendment is part of the same lineage, not a new ADR.
