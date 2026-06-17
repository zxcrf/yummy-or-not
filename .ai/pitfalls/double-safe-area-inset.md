# Pitfall: double safe-area inset (route + screen both pad `insets.top`)

**Date:** 2026-06-17 · **Related:** PR #135 (failed first attempt), PR #136 (real fix), [[yummy-or-not-edit-header]] · ADR 0001 (EditActionHeader)

## Symptom

A large dead band of empty space above the top chrome on a routed screen —
specifically the taste 编辑 screen showed ~`2×insets.top + 12` (~106px on a
notched phone) of whitespace above the 取消/编辑/保存 `EditActionHeader`. Read
mode looked fine; only the mode that renders `EditActionHeader` was affected.

## Root cause

The top safe-area inset was applied **twice** in edit mode:

1. The route wrapper `app/taste/[id].tsx` did `<View style={{ paddingTop: insets.top }}>`.
2. `EditActionHeader` (rendered by `DetailView` in edit mode) internally does
   `padTop = insets.top + 12`.

Stacked → `insets.top` (route) + `insets.top + 12` (header). The reference
screen **AddModal** never doubled because its route (`add.tsx`) is
`absoluteFill` with **no** inset — the header owns the inset alone.

PR #135's mistake: it "fixed" the gap by tweaking the *content* `paddingTop`
(36→20) **below** the header. The real dead band was **above** the header, so
the symptom survived. Tweaking a number near the symptom ≠ finding which layer
owns the inset.

## Fix

One layer owns the inset. Move inset ownership into the screen component
(mirror AddModal): the route stops padding; the screen applies `insets.top`
exactly once per mode — edit mode via `EditActionHeader`, read mode via its own
wrapper.

## Secondary trap — padding on a `position:'relative'` wrapper moves only flow children

First fix attempt put `paddingTop: insets.top` directly on the read-mode
`<View style={{ position:'relative' }}>`. That pushes **normal-flow** children
(the photo box) down, but **absolutely-positioned** children (back button
`top:16`, verdict stamp `bottom:-22`, video play overlay) are positioned against
that wrapper's box, and Yoga's absolute-vs-padding behavior is
version/errata-dependent (`YGErrataAbsolutePositioning`). The original working
layout had the inset on a **non-positioned ancestor** (the route View), which
shifted the whole block — absolutes included — uniformly.

**Rule:** to shift a `position:'relative'` block *and its absolute children*
together, put the padding on an **outer non-positioned wrapper**, never on the
relative element itself.

## Prevention

- One owner per safe-area inset. Before adding `paddingTop: insets.top`, check
  whether a parent route/layout already pads it. Don't pad inset at both the
  route and the screen.
- When a top gap is "too big," measure **which layer** contributes it (route vs
  header vs content) before changing any number. The fix is usually removing a
  duplicate inset, not shrinking a content pad.
- To move a `position:'relative'` subtree with absolute children, pad an outer
  non-positioned wrapper.
- Pin the regression at the **source layer**: a route-level test asserting the
  route container has no `paddingTop` (mount the route with the screen stubbed)
  catches re-introduction independently of screen internals. Use
  `StyleSheet.flatten(style)` before reading style keys (styles may be arrays).
