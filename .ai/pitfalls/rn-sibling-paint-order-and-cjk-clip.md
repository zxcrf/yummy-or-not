# Pitfall: in-tree overlay covered by later siblings (RN paint order) + bold CJK title clipping

**Date:** 2026-06-18 · **Related:** PR #153 (我的口味 dropdown + title clip), [[yummy-or-not-library-redesign]], PageHeader/LibraryView

## Symptom

Two separate UI bugs in the same `我的口味` header area:

1. **Dropdown covered by the tag row.** The viewMode dropdown (我的口味 / 想吃的)
   opened, but the filter chips (全部/Burger/Coffee) + cards painted *on top* of
   the menu — the second item (想吃的) was hidden behind the tag row.
2. **Centered bold title clipped top & bottom.** 「我的口味」/「标签管理」/「家人」
   centered titles (fontSize 28, fontWeight 700) had the top and bottom of each
   glyph cropped on Android.

## Root cause

1. **RN paints later siblings on top.** The dropdown overlay (an in-tree
   `absoluteFill` sibling, *not* a `Modal` portal) was rendered in JSX *before*
   the `ScrollView`. So the ScrollView (tag chips + cards) — a later sibling —
   painted over it. The block's own comment claimed it was "rendered after the
   header so the menu overlays the ScrollView," but its actual position was
   *between* the search box and the ScrollView. The sibling `filter sheet`
   worked precisely because it sat *after* the ScrollView.
2. **Default line box tighter than bold CJK ink bounds.** The 28px bold title
   had no explicit `lineHeight`, so Android's default line box was shorter than
   the actual ink extent of bold CJK glyphs and cropped them.

## Fix

1. Move the dropdown overlay block to render *after* the `ScrollView` (later
   sibling ⇒ paints on top), mirroring the working filter-sheet placement. Copy
   the block verbatim — same `testID`s, backdrop, `pointerEvents="box-none"`,
   `absoluteFill`. No `zIndex`/`elevation` needed; document order is the lever.
2. Add `lineHeight: 38` + `includeFontPadding: true` to the title style
   (`PageHeader styles.title` for the string path 标签管理/家人/recall, and
   `LibraryView`'s inline title `Text`). `lineHeight ≈ 1.35× fontSize` for bold
   CJK display text.

## Prevention

- **In-tree overlays (no Modal portal): order = z-order.** An `absoluteFill`
  overlay must be a *later* JSX sibling than any scroll/content it should cover.
  Don't trust a comment that says "renders on top" — check where the block
  actually sits relative to the content. When unsure, mirror an overlay in the
  same file that already stacks correctly (here: the filter sheet).
- **Test paint order structurally.** react-test-renderer does no layout, so
  assert *document order*: walk `root.findAll`, collect `testID`s, and assert the
  overlay's `testID` index > the content's `testID` index. This pins the
  regression (old layout: menuIdx < filterRowIdx → fail; fixed: menuIdx > filterRowIdx).
- **Bold CJK display text needs an explicit, generous `lineHeight`.** Don't rely
  on the default line box at large sizes. Pin it at the source layer: assert the
  title style has `lineHeight >= fontSize` and `includeFontPadding === true`.
