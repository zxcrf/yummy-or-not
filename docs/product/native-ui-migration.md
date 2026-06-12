# Native UI Migration — Drop Web Target + Replace Tamagui with Plain RN

Status: design (architect). Branch `refactor/drop-web-native-ui`, worktree
`.worktrees/drop-web-native-ui`. Mobile-only (Android primary, iOS later).

Mission: delete the web target entirely and replace Tamagui (`styled()` +
tokens + animation driver) with plain React Native (`View`/`Text`/`Image`/
`TextInput` + `StyleSheet.create`). Preserve the exact visual design and the
motion contract in `material-motion.md`. Keep DS component public prop APIs so
business screens change minimally.

---

## 1. Target architecture

### 1.1 Theme module (replaces `tamagui.config.ts`)

New file `apps/mobile/theme/index.ts` (barrel) exporting **resolved plain TS
constants** — no `createTokens`, no `$token` strings. All values are the exact
hex / numbers already in `tamagui.config.ts`.

```
theme/colors.ts    // every palette key as hex (ink900='#191017', candyPink='#ff2e88', …)
                   //   + token-group semantic aliases (config L98-100):
                   //       brand=candyPink, brandDeep=candyPinkDeep, focusRing=candyBlue
                   //   + FULL `yum` theme alias map (config L228-267) — audit ALL of:
                   //       background=paper, backgroundHover=paper2, backgroundPress=paper3,
                   //       backgroundFocus=paper2, backgroundStrong=white(#fff),
                   //       backgroundTransparent='rgba(255,246,230,0)',
                   //       color=ink900, colorHover=ink700, colorPress=ink900,
                   //       colorFocus=ink900, colorTransparent='rgba(25,16,23,0)',
                   //       colorMuted=ink500, colorFaint=ink400,
                   //       borderColor=ink900, borderColorHover=ink900,
                   //       borderColorPress=ink900, borderColorFocus=candyBlue,
                   //       borderColorSoft=ink200,
                   //       brand=candyPink, brandDeep=candyPinkDeep,
                   //       success=verdictYum, warning=verdictMeh, danger=verdictNah,
                   //       info=candyBlue,
                   //       shadowColor=ink900 (+Hover/Press/Focus all=ink900)
                   //   RULE: enumerate every alias from tamagui.config.ts before B1
                   //   resolves them — a missing key = silent wrong color or undefined ref.
                   //   Each alias resolves to its palette hex (e.g. colorMuted='#6b5b65').
theme/space.ts     // space[0..12]+true (4px grid: 0,4,8,12,16,20,24,32,40,48,64,80,96)
                   //   radius{0,xs:4,sm:6,md:10,lg:16,xl:22,pill:999}
                   //   borderWidths{thin:2,base:3,thick:4}
                   //   zIndex{base:1,sticky:100,overlay:1000,toast:2000}
theme/type.ts      // fontSize 1..12 (10,11,12,14,16,18,22,28,36,48,64,84),
                   //   lineHeight 1..12 (14,16,17,20,23,26,27,34,43,58,77,101),
                   //   fontWeight map (1:'300',4:'400',5:'500',6:'600',7:'700'),
                   //   letterSpacing map (1:-0.32,4:0,5:0.64,6:1.92) — createFont scale 1:1.
                   //   ALSO export `textBase` default style (see §1.1b Text defaults).
theme/shadows.ts   // popShadow{xs,sm,md,lg,pink,blue} (already plain RN objects in
                   //   tamagui.config — copy verbatim) + pressedShadow variants
theme/motion.ts    // Reanimated spring configs: bouncy{damping:9,stiffness:150,mass:0.9},
                   //   quick{damping:20,stiffness:250}, lazy{damping:15,stiffness:100};
                   //   timing presets t100{duration:100}, t200{duration:200}
theme/index.ts     // re-export all; also `export const colors`, `space`, `radius`, etc.
```

Rule (repo convention): tokens are **resolved at authoring time** into hex /
numbers. No runtime token lookup, no theme context, no `useTheme()`. The four
verdict sub-themes (`yum_yum/meh/nah`) are **unused at runtime today** (no
`<Theme name=>` callsites found) → drop them; verdict tinting is already done
per-component via explicit `colors.verdictYum` etc.

`assets/global.css` (web CSS-var dump) is deleted with the web teardown.

### 1.1b Text/font defaults (MAJOR-3) — how every RN `<Text>` keeps the type baseline

Tamagui `Text` auto-inherited family / lineHeight / weight / letterSpacing from
`createFont`. Plain RN `Text` has **no global default** — every migrated `<Text>`
must carry its baseline explicitly or dense screens and `AnimatedNumber` drift.

Mitigating fact (config-verified): both `bodyFont` and `displayFont` use
`family: 'System'` (config L169, L218 — the Pixelify display .ttf is NOT yet
bundled), and `System` IS RN's default family. So **font FAMILY needs no wrapper**
today — RN already matches. The drift risk is **lineHeight / weight / letterSpacing**,
which RN does NOT default to the Tamagui scale.

**Decision — shared `Text` wrapper, not per-callsite styling.** Add
`theme/Text.tsx` exporting a thin `Text` that applies `textBase`
(`{ color: colors.ink900, fontSize: type.fontSize[5] /*16*/, lineHeight:
type.lineHeight[5] /*23*/, fontWeight: '400' }`) then spreads caller `style`
last so any explicit size/weight/spacing wins. Screen + DS migrations import
`Text` from `@/theme` instead of `react-native`. Rationale:
- One place owns the baseline; matches Tamagui's inherited default exactly (size 5
  / lineHeight 5 / weight 400 is the createFont `true` default).
- No need to hand-annotate lineHeight on hundreds of callsites (the error-prone path).
- Callsites that already set `fontSize=11` etc. still override; the wrapper only
  fills the gaps RN leaves blank.
- `AnimatedNumber` and any `Animated.Text` get the same baseline by importing the
  wrapper's `textBase` style object directly (Reanimated `Animated.Text` can't be
  the wrapper component, so it consumes `textBase` as a style).

Document this wrapper in B1 (theme foundation) and require every Wave-1/Wave-3
`<Text>` swap to import `@/theme`'s `Text`, never bare `react-native` `Text`,
unless the callsite is an `Animated.Text` (then apply `textBase` inline).

### 1.2 Component pattern: `styled()` + variants → StyleSheet + prop helper

Each DS component becomes: a plain functional component that picks styles from a
`StyleSheet.create` block keyed by variant, merging base + variant + state into a
style array. No `styled()` factory, no `GetProps<>` inference.

Canonical pattern (Button as the template all L1 components follow):

```tsx
import { Pressable, Text, StyleSheet } from 'react-native'
import { colors, radius, space, popShadow } from '@/theme'
import { usePressScale } from '@/theme/usePressMotion' // Reanimated press driver

const styles = StyleSheet.create({
  base: { flexDirection:'row', alignItems:'center', justifyContent:'center',
          alignSelf:'flex-start', gap:space[2], borderWidth:3,
          borderColor:colors.ink900, borderRadius:radius.md, ...popShadow.sm },
  primary:{ backgroundColor:colors.brand },
  secondary:{ backgroundColor:colors.white },
  // … one key per variant value …
  sm:{ paddingHorizontal:space[3], paddingVertical:7, borderRadius:radius.sm },
  block:{ alignSelf:'stretch', width:'100%' },
  disabled:{ opacity:0.45 },
})
// LABEL_COLOR / LABEL_FONT maps stay as-is (already plain).
```

- **Props API unchanged.** `ButtonProps` keeps `variant/size/block/disabled/
  iconLeft/iconRight/children`, but the type is hand-written (was
  `Omit<GetProps<typeof Frame>, …>` → now `& ViewProps`-ish hand type). The
  extra Tamagui style-shorthand props (`{...rest}` previously accepting `p`,
  `bg`, `cursor`…) are **dropped**; callers that relied on passing layout props
  through DS components must pass them via an explicit `style` prop where the
  rewrite exposes one (audit per component, see §2).
- **Drop web-only props** entirely: `cursor`, `hoverStyle`, `focusStyle`
  (Tamagui), `boxShadow` web string, `aria-*` (replace with RN
  `accessibilityState`). These are listed per component in §2.
- **`pressStyle` → motion driver.** Tamagui's `pressStyle` + `animation` prop is
  re-expressed with the Reanimated press hook (§1.3). The visual delta
  (translate into shadow / scale / opacity) is replicated exactly.

### 1.3 Motion implementation — choice: **react-native-reanimated** (not Animated)

Decision: **Reanimated 4.3.1**. Justification:
- Already a direct dependency (`react-native-reanimated@4.3.1` +
  `react-native-worklets@0.8.3` in `package.json`) — **no new dep**.
- Switch, `_nav` (AnimatedTab/AnimatedFab), `add.tsx` Container Transform, and
  the `Screen` `FadeIn` already use it. Mixing in RN `Animated` would create two
  motion systems; one driver is the maintainability win.
- The motion contract's spring presets (`bouncy/quick/lazy`) map 1:1 to
  `withSpring(config)`. `FadeIn/FadeOut` layout animations are Reanimated
  primitives already in use (AddModal banner/error, Screen, LangSwitcher).

Shared press driver `theme/usePressMotion.ts`:
- `usePressScale(config)` → returns `{ animatedStyle, onPressIn, onPressOut }`
  driving a `scale` shared value (Tag 0.92, VerdictPicker 0.95, FoodCard 0.98,
  LangSwitcher trigger 0.95 + opacity 0.85, AuthScreen MethodTab 0.95+0.8).
- `usePressNudge(config)` → drives `translateX/Y` + collapses shadowOffset for
  the pop-shadow press (Button/IconButton x:3 y:3, Card x:2 y:2). Implemented as
  an animated `translateX/translateY` + a derived `shadowOffset` (iOS) — Android
  elevation can't animate shadowOffset, so Android keeps the translate only,
  exactly matching today's "Known Issues" note in `material-motion.md`.
- The DS Pressable wraps an `Animated.View` whose `style` includes the driver's
  animated style. Press feedback presets pulled from `theme/motion.ts`.

This replaces the Tamagui `animation` driver + `components/ds/animation.ts`
(both deleted). The motion contract document does not need rewriting (the
presets are unchanged); only the implementation backend changes — note this in
the doc's "Architecture Decisions §1" as superseded.

### 1.3b Press-driver event-composition contract (MAJOR-4)

`usePressScale`/`usePressNudge` return `{ animatedStyle, onPressIn, onPressOut }`.
A naive `<Pressable onPressIn={driver.onPressIn}>` **silently drops** any
caller-supplied `onPressIn`/`onPressOut` and ignores `disabled`. Every migrated DS
component MUST follow these composition rules (and test them):

1. **Forward caller handlers.** The component composes its own + the caller's:
   `onPressIn={(e) => { driver.onPressIn(); props.onPressIn?.(e) }}` and the same
   for `onPressOut`. Never assign the driver handler raw. (Tag, VerdictPicker,
   Button, IconButton, Card-interactive, LangSwitcher trigger all expose `onPress`/
   `onPressIn`/`onPressOut` via `...rest`.)
2. **`disabled` suppresses animation AND sets accessibility.** When `disabled`,
   the press handlers must NOT fire the driver (no scale/nudge), the `Pressable`
   gets `disabled` (so `onPress` is blocked), AND
   `accessibilityState={{ disabled: true }}` is set. Visual disabled style
   (`opacity:0.45`) stays. Do not rely on opacity alone — the a11y state is the
   regression Codex flagged.
3. **`hitSlop`** from caller `...rest` passes through to `Pressable` untouched.
4. **Pressable render-prop `pressed`.** Components driven by the animation hook do
   NOT use the `pressed` render-prop (the shared value drives visuals). The ONE
   exception is **FoodCard**, which intentionally keeps the manual `pressed`-boolean
   render-prop (no hook) — it must still compose caller `onPress` and honor
   `disabled` the same way; the `FoodCardPress` test pins single-responder routing.
5. **`accessibilityRole`** stays as today (`button`/`switch`/etc.); `aria-*` is
   NOT forwarded (converted to `accessibility*` per §1.4b rule 2).

Encode rule 1 + 2 in tests: a Button/Tag test asserting the caller's `onPressIn`
spy fires AND `accessibilityState.disabled === true` when `disabled` (added to §6).

### 1.4 Layout primitives: `XStack`/`YStack`/`View`/`Text` → RN

- `tamagui` `View` → RN `View`; `Text` → RN `Text`; `ScrollView` → RN
  `ScrollView`.
- `XStack` → `<View style={{ flexDirection:'row' }}>`; `YStack` → `<View>`
  (RN default is column). Where `XStack`/`YStack` carried token props (`gap`,
  `padding="$4"`, `bg="$x"`), they become inline `style` with resolved values
  (`gap:space[4]`, `padding:space[4]`, `backgroundColor:colors.paper`).
- Tamagui token-string props on inline `View`/`Text` (`color="$ink900"`,
  `fontSize={11}`, `paddingHorizontal="$5"`, `onPress` on a `View`) → RN style
  object + (for tappable Views) wrap in `Pressable`. `onPress` does **not**
  exist on RN `View`; every `<View onPress>` in screens (AddModal mode selector,
  photo dropzone, banner rows, etc.) must become `Pressable`.
- `useMedia()` (Tamagui) → `useWindowDimensions()` + `const isWide = width >=
  768` (renamed from `isDesktop`; kept as Android tablet/foldable support per
  orchestrator decision #2).

### 1.4b Green-invariant strategy — how narrowed DS props stay typecheck-clean

**Problem (Codex CRITICAL-2).** When a Wave-1 DS component is rewritten with a
narrow hand-written props type, Wave-3 screen callsites still pass Tamagui-era
shorthands to it (`YouView.tsx:324` `Card marginTop="$4"`; `StatsView.tsx:283`
`Card marginTop="$6" maxWidth={720}`; FoodCard passes `position/top/right` to Tag
& VerdictStamp; AddModal/DetailView pass `aria-label` to DS Buttons). If B2–B6/B4b
emit a strict props type and per-batch `typecheck` is green-gated, the tree breaks
**before** the Wave-3 callsite cleanup runs. The "DISJOINT files per batch" rule is
violated by these cross-file type edges.

**Resolution (mandatory rule for every DS rewrite batch):**

1. **Each migrated DS component accepts a `style?: StyleProp<ViewStyle>` pass-through**
   AND **spreads `...rest: ViewProps`** (or `PressableProps` for tappable ones)
   onto the outermost RN node. RN `View`/`Pressable` legitimately accept
   `accessibilityLabel`, `testID`, `pointerEvents`, etc., so the rest-spread is
   real, not a compat hack — it just no longer accepts Tamagui shorthands.

2. **Tamagui *shorthand* props (`marginTop="$4"`, `maxWidth`, `bg`, `px`, `position`/
   `top`/`right`, `aria-label`) are NOT valid `ViewProps`** → they would fail tsc
   the moment the type narrows. **CORRECTION (Codex r2 CRITICAL-2):** in strict
   mode unknown JSX props do NOT silently ride `...rest: ViewProps` — `position`/
   `top`/`right`/`aria-label`/`marginTop` are excess properties that tsc rejects at
   the migrated callsite immediately. There is no "harmless intermediate" window.
   Therefore the **migrating DS batch co-locates the callsite fix for EVERY consumer
   of that component, in the same atomic batch** (option (c)). Concretely:
   - **B4b (Card)** also edits `YouView.tsx:324` (`marginTop="$4"`→`style={{ marginTop: space[4] }}`)
     and `StatsView.tsx:283` (`marginTop="$6" maxWidth={720}`→`style={{ marginTop: space[6], maxWidth: 720 }}`).
     These are the ONLY two external Card callsites with shorthands (grep-verified);
     the rest of YouView/StatsView migrate in B12. (B4b's narrowed type still keeps
     a permissive `...rest`; the issue is only the shorthand props, which are fixed
     here.)
   - **B4 (Tag)** + **B5 (VerdictStamp)** ship `style?` AND **co-locate the FoodCard
     callsite fix** (`components/ds/FoodCard.tsx:159-179`: move `position="absolute"
     top="$2" right="$2"` off both the `<Tag>` and the `<VerdictStamp>` into
     `style={{ position:'absolute', top:space[2], right:space[2] }}`). FoodCard is
     the SOLE external callsite passing these props to Tag/VerdictStamp (grep-verified
     — AddModal does NOT pass position to Tag; the earlier §2 Note claiming it did was
     wrong). B7 then completes the rest of FoodCard's migration. Because B4 and B5
     both touch FoodCard.tsx (only the Tag-line / VerdictStamp-line respectively) and
     B7 also touches FoodCard.tsx, **B7 dependsOn [B4, B5]** and must rebase on them;
     the FoodCard position→style edits are surgical and confined to the two JSX blocks
     each batch owns. (Alternative considered — gate B4/B5 on B7 — was rejected: it
     inverts the wave order, since FoodCard is a Wave-2 composite that itself depends
     on Tag/VerdictStamp being migrated first.)
   - **`aria-label` on DS Buttons/IconButtons** (AddModal dropzone, DetailView) →
     `accessibilityLabel`, fixed in the Button batch's callsite sweep (B2 greps
     `aria-label=` on `<Button`/`<IconButton` across screens and converts them) so
     no screen passes `aria-*` to a migrated Button before Wave 3.
   - **`aria-label` on DS `Input` (Codex r2 CRITICAL-1):** `LibraryView.tsx:125`,
     `TodoView.tsx:82`, and `RecallView.tsx:264` each pass `aria-label={…}` to
     `<Input>`. B3 narrows `InputProps` to `TextInputProps` in Wave 1, but those
     three screens migrate in B11 (Wave 3) — so per-batch tsc breaks at B3 unless
     fixed. **B3 co-locates the Input `aria-label`→`accessibilityLabel` callsite
     sweep** (same co-located-callsite rule as Button). B3's file list therefore
     adds `LibraryView.tsx`, `TodoView.tsx`, `RecallView.tsx` (single-line edits;
     B11 migrates the rest of each). RN `TextInput` accepts `accessibilityLabel`,
     so this is a real swap, not a stub.

3. **The single ordering guarantee that makes per-batch green hold:** a DS batch is
   "green" only when, for the component(s) it narrows, **every callsite passing a
   now-invalid prop has been converted in the SAME batch** (no reliance on
   `...rest` absorbing excess props — strict tsc rejects them). The narrowing edit
   and its blast-radius callsite edits are ONE atomic batch. This is why B2 (Button,
   incl. Button `aria-label` sweep), B3 (Input, incl. Input `aria-label` sweep),
   B4/B5 (Tag/VerdictStamp, incl. FoodCard position→style), and B4b (Card, incl. two
   Card shorthand callsites) explicitly list cross-file callsite edits in their file
   lists — they are no longer pure-DS-file batches. Run `codegraph_callers` /
   `rg "<Card |<Button |<Tag |<VerdictStamp |<Input "` per migrated component to
   enumerate callsites before declaring the batch done; tsc is the backstop, not the
   discovery tool.

4. **Fallback if a callsite can't move in-batch** (e.g. component consumed by a
   not-yet-migrated screen that itself still imports tamagui): keep the prop on the
   component's hand type **temporarily** as `marginTop?: number` etc. (explicit,
   typed, resolved-value-only — NOT a token string) and delete it in the consuming
   screen's Wave-3 batch. Prefer co-location (rule 2); this is the escape hatch only.

### 1.5 Responsive `isWide` (kept)

`LibraryView`, `TodoView` two-column grids and the `_nav` sidebar are **kept**,
repositioned as tablet/foldable support. Rename `isDesktop` → `isWide`. `_nav`
swaps `useMedia().gtMd` → `useWindowDimensions().width >= 769`; `_screen.tsx`
swaps `media.gtMd` → same. Sidebar + `SIDEBAR_W` gutter stay.

---

## 2. Per-DS-component replacement map

API = public props kept (✓) unless noted. "render core" = what RN primitives
replace the Tamagui frame. Web-only props dropped in every row.

| Component | API | Render core | Motion | Test impact |
|---|---|---|---|---|
| **Icon** | ✓ | already pure `react-native-svg` (no Tamagui) | none | one-line fix: drop `aria-label` (see below) — owned by B6 |
| **animation.ts** | — | **DELETE** (replaced by `theme/motion.ts`) | — | none |
| **Button** | ✓ (drop pass-through style shorthands; keep `style?`) | `Pressable`→`Animated.View` frame + `Text` | `usePressNudge(bouncy)` | none today; add Button.test |
| **IconButton** | ✓ | `Pressable`→`Animated.View` square frame | `usePressNudge(bouncy)`, shadow→none on press | none |
| **Input** | ✓ (`label/hint/error`+TextInputProps) | **single RN `TextInput`** (drop iOS/web Tamagui branch — Android branch becomes the ONLY path; iOS gets same plain field). Border-color focus state via `useState`. Drop web `type='password'`. **Co-located callsite fix (B3, Codex r2 CRITICAL-1):** `LibraryView.tsx:125` / `TodoView.tsx:82` / `RecallView.tsx:264` pass `aria-label`→`accessibilityLabel`. | focus = border color swap (no shadow anim needed; matches Android today) | `Input.test.tsx` must still pass: real `TextInput`, `style.color==='#191017'`. Already asserts this. Verify hex constants unchanged. |
| **Textarea** | ✓ | same as Input, `multiline`, `textAlignVertical:'top'`, `minHeight:88` | focus border swap | add Textarea regression test (mirror Input) |
| **Card** | ✓ (`variant/padded/interactive` + add `style?`) | `View` or (interactive) `Pressable`→`Animated.View`; `bg=colors.backgroundStrong`(#fff) | `usePressNudge(quick)` x:2 y:2, shadow 5x5→3x3 | **batch B4b** (own file, imports tamagui). callsites YouView/StatsView pass `marginTop`, StatsView `maxWidth` → consumed via `style?` (see §2 Notes / Wave 3) |
| **Tag** | ✓ (`active/onRemove/onPress`) | `View`/`Pressable`→`Animated.View` pill | `usePressScale(quick)` 0.92 + opacity 0.85 | `Tag` test exists — verify still green |
| **Badge** | ✓ (`tone`) | `View`+`Text`, no web props originally | none | none |
| **Avatar** | ✓ (`src/name/size/circle`) | `View`+expo-`Image`/`Text` | none | none |
| **Switch** | ✓ (`checked/onChange/disabled`) | `Pressable` track + Reanimated `Animated.View` knob (**already reanimated** — only the `styled(View)` Track → `View`+StyleSheet). `accessibilityState={{checked}}` not `aria-checked` | knob `withSpring`{15,200} (unchanged) | **B6 updates `YouView.test.tsx` `aria-checked`→`accessibilityState.checked`** (real-render) |
| **VerdictStamp** | ✓ (`verdict/size/showFace/rotate/label`) | `View`+`Text`, `transform:[{rotate}]` | none | none |
| **VerdictPicker** | ✓ (`value/onChange/labels`) | 3× `Pressable`→`Animated.View` options | `usePressScale(bouncy)` 0.95; selected = border/shadow swap | `Verdict` test exists — verify |
| **FoodCard** | ✓ (full taste props) | keep manual `Pressable` render-prop pattern (scale 0.98 + shadow collapse driven by `pressed` flag — **no animation driver needed**, it already uses the `pressed` boolean; just resolve tokens). expo-`Image` cacheKey unchanged. | `pressed`→scale/shadow (manual, as today) | `FoodCardPress.test.tsx` (Pressable routing, no double responder) + `FoodCardImage.test.tsx` (cacheKey) MUST stay green |
| **LangSwitcher** | ✓ (`value/onChange/languages/align/tone/triggerMode`) | **drop web Portal/`document` branch entirely**; keep native `Modal` + `position:absolute` + Reanimated `FadeIn/Out` dropdown. Trigger `Pressable`→`Animated.View`. `measureInWindow`+`Dimensions` positioning kept. `tone` prop type narrows from Tamagui token-string to resolved color — **B8 co-locates the two tone callsites** (`_nav.tsx:117` + `AuthScreen.tsx:124` `tone="$candyPink"`→`tone={colors.candyPink}`), since those screens migrate later (B14/B12). | trigger `usePressScale(quick)`; dropdown `FadeIn(150)/FadeOut(100)` | `LangSwitcherFlag.test.tsx` (Android flag centering) MUST stay green |
| **index.ts** (barrel) | ✓ | re-export 14 components + hand-written prop types | — | none |

Notes:
- **Input/Textarea collapse to one path.** Today iOS/web use Tamagui `Field`,
  Android uses raw `TextInput`. Post-migration there is no web and Tamagui is
  gone, so **all platforms use the raw `TextInput`** with concrete hex
  (`#191017` text, `#8f8189` placeholder, `#2f6bff` selection, `includeFontPadding:
  false`, `textAlignVertical`). This is the safest path and what the regression
  test already pins. iOS focus shadow (pop look) is dropped in favor of the
  border-color focus already used on Android — acceptable, consistent, and the
  motion contract lists input focus shadow as iOS/web-only anyway.
- **GetProps types gone.** Each component exports a hand-written props type
  (`variant?: …; style?: StyleProp<ViewStyle>; …` + `...rest: ViewProps`/
  `PressableProps`). This narrows the public API — callers passing Tamagui
  shorthands (`bg`, `px`, `mt`/`marginTop`, `maxWidth`, `position`/`top`/`right`,
  `aria-label`, `tone="$token"`) must move to `style` / `accessibility*` / resolved
  values. **The narrowing batch co-locates its callsite fixes — see §1.4b for the
  green-invariant rule and the exact callsite list.** Audit (grep-verified): FoodCard
  is the ONLY callsite passing `position/top/right` to Tag & VerdictStamp (AddModal
  does NOT pass position to Tag — earlier draft was wrong); YouView/StatsView pass
  `marginTop`/`maxWidth` to Card; `_nav`/`AuthScreen` pass `tone="$candyPink"` to
  LangSwitcher → those components expose `style?` / resolved props.
  Expose `style?: StyleProp<ViewStyle>` on Tag, VerdictStamp, Badge, Card, Button,
  IconButton, Avatar, Input(container), Textarea(container).

---

## 3. Screen migration pattern

Every screen file does the same mechanical transform (no behavior change):

1. Replace `import { … } from 'tamagui'` with `react-native` (`View`,
   `ScrollView`) + `@/theme` (`colors`, `space`, `radius`, **and `Text`** — import
   the baseline-default `Text` wrapper from `@/theme`, NOT bare `react-native`
   `Text`, per §1.1b; only `Animated.Text` callsites use bare RN + `textBase` inline).
2. `XStack` → `View` with `style={{ flexDirection:'row', … }}`. `YStack` →
   `View`.
3. Every Tamagui token prop → resolved style: `color="$ink900"` →
   `style={{ color: colors.ink900 }}`; `paddingHorizontal="$5"` →
   `paddingHorizontal: space[5]`; `backgroundColor="$background"` →
   `colors.paper`; `gap="$3"` → `gap: space[3]`.
4. `<View onPress=… cursor="pointer">` → `<Pressable onPress=…>` (drop
   `cursor`). `accessibilityRole` kept; `aria-label` → `accessibilityLabel`.
5. Reanimated `Animated.View entering={FadeIn…}` blocks stay (already RN).
6. Keep `KeyboardAwareScrollView`/`KeyboardStickyView` from
   `react-native-keyboard-controller` exactly — keyboard UX is unchanged and not
   Tamagui-dependent.

Per-screen platform/web cleanup (in addition to the mechanical swap):

| Screen | Web/desktop code to remove |
|---|---|
| AuthScreen | `Platform.OS==='web'` OAuth branch (L86) → native `expo-web-browser` only. MethodTab press → `usePressScale`. LangSwitcher `tone="$candyPink"` callsite (L124) ALREADY resolved by B8 — do not re-touch that line. |
| AddModal | hidden `<input type=file>` (L615), `onWebFileChange`, `fileInputRef`, `onPhotoPress` web branch (L309) → `pickFromLibrary` only. All `<View onPress>` → `Pressable`. |
| DetailView | `Platform.OS==='web'` sharing early-return (L104) → native `Sharing` only. |
| LibraryView | rename `isDesktop`→`isWide` (keep two-col `>=768`). Input `aria-label` callsite (L125) ALREADY resolved by B3 — do not re-touch. |
| TodoView | rename `isDesktop`→`isWide` (keep). Input `aria-label` callsite (L82) ALREADY resolved by B3 — do not re-touch. |
| YouView | mechanical swap (Card `marginTop` callsite L324 ALREADY fixed by B4b; do not re-touch that line). `YouView.test.tsx` aria-checked already fixed by B6. |
| RecallView | mechanical swap; `useWindowDimensions` height calc stays. Input `aria-label` callsite (L264) ALREADY resolved by B3 — do not re-touch. |
| StatsView | mechanical swap (Card `marginTop`/`maxWidth` callsite L283 ALREADY fixed by B4b). AnimatedNumber uses `textBase` inline (§1.1b). |
| TagManageView | mechanical swap. |

Provider web branches:
- `AuthProvider.tsx` L70/84/136: drop `localStorage` branch → `expo-secure-store`
  only.
- `I18nProvider.tsx` L66/84: drop `localStorage` branch → `AsyncStorage` only.

Nav/layout:
- `_nav.tsx`: `useMedia()`→`useWindowDimensions`; `media.gtMd`→`width>=769`.
  Keep Sidebar + TabBar + AnimatedTab/AnimatedFab (already reanimated). Swap
  Tamagui `Text`/`View` → RN + resolved styles. LangSwitcher `tone="$candyPink"`
  callsite (L117) ALREADY resolved by B8 — do not re-touch that line.
- `_screen.tsx`: `useMedia`→`useWindowDimensions`; keep `SIDEBAR_W` gutter +
  `FadeIn(260)`.
- `_layout.tsx`: remove `import '../assets/global.css'`, remove
  `TamaguiProvider`+`Theme` wrapper (keep `SafeAreaProvider`,
  `KeyboardProvider`, `I18nProvider`, `AuthProvider`, `AppGate`,
  `AddTransitionProvider`, `Stack`). `contentStyle` hex already concrete.
- `add.tsx`: **no change** — already pure Reanimated; only `Icon` import (kept).
- `taste/[id].tsx`: mechanical swap (imports tamagui).

---

## 4. Web teardown list (delete)

Mobile:
- `apps/mobile/assets/global.css` (delete)
- `apps/mobile/tamagui.config.ts` (delete after theme module lands)
- `apps/mobile/components/ds/animation.ts` (delete)
- `apps/mobile/__mocks__/tamagui.js` (delete after all tamagui imports gone)
- `apps/mobile/app.json`: remove `web` section + `experiments.baseUrl:'/web'`
- `apps/mobile/babel.config.js`: remove `@tamagui/babel-plugin` block
- `apps/mobile/package.json` deps remove: `tamagui`,
  `@tamagui/animations-react-native`, `@tamagui/babel-plugin`,
  `@tamagui/config`, `@tamagui/core`, `react-dom`, `react-native-web`,
  `@expo/metro-runtime`; scripts remove `web`
- `apps/mobile/jest.config.js`: remove `tamagui`→mock `moduleNameMapper` entry

API:
- `apps/api/public/web/` (14M committed SPA — delete dir)
- `apps/api/scripts/embed-web.mjs` (delete)
- `apps/api/package.json`: remove `build:web` script
- `apps/api/next.config.mjs`: remove `/`→`/web` redirect + `/web` rewrites

Root / e2e / CI (orchestrator decision #1: delete Playwright-on-Expo-Web):
- `e2e/` (entire dir — delete)
- `playwright.config.ts` (delete — whole harness goes; Maestro native e2e is a
  separate follow-up)
- `package.json` (root): remove `e2e` + `e2e:mobile` scripts, remove
  `@playwright/test` devDep
- `Dockerfile`: no change (it copies `public/` generally; only the `web/`
  subdir is gone — verify no missing-path error at runtime)
- `.github/workflows/`: no web/e2e triggers found → no change
- `vercel.json`/`turbo.json`/`.gitignore`/`.dockerignore`: no change (verify
  `vercel` build no longer invokes `build:web`)

---

## 5. Work breakdown — batches

All work in worktree `.worktrees/drop-web-native-ui` on
`refactor/drop-web-native-ui`. **Invariant: tsc + jest (mobile + api) green at
the end of every batch.** Batches within a wave edit DISJOINT files and are
agent-parallelizable **EXCEPT** for the cross-file callsite edges named in §1.4b:
a DS batch that narrows a component's props type also owns the in-same-batch
callsite fixes for that component (strict tsc rejects the now-invalid props
immediately — there is no `...rest`-absorbs-it grace window). Cross-file callsite
ownership, complete list:
- **B2** owns the `aria-label`→`accessibilityLabel` Button/IconButton sweep
  (AddModal dropzone, DetailView, …).
- **B3** owns the Input `aria-label`→`accessibilityLabel` sweep (LibraryView:125,
  TodoView:82, RecallView:264).
- **B4** + **B5** own the FoodCard Tag / VerdictStamp `position/top/right`→`style`
  moves (B4 Tag block, B5 VerdictStamp block; run B5 after B4 to avoid a concurrent
  FoodCard.tsx write).
- **B4b** owns the two Card `marginTop`/`maxWidth` callsites (YouView:324,
  StatsView:283).
- **B6** owns the Icon `aria-label` deletion (Icon.tsx:43).
- **B8** owns the LangSwitcher `tone="$candyPink"`→`tone={colors.candyPink}` fixes
  (_nav:117, AuthScreen:124).

Those screen/composite files are therefore touched by the DS batch AND again (for
the rest of the file) by the Wave-2/Wave-3 batch — the later batch must rebase on
the completed DS batch, not run concurrently against the same file.
Cross-model code review (Codex) on the full diff is a gate before PR (not a batch).

Ordering: (Wave 0) web/api/e2e teardown + theme foundation ‖. (Wave 1) DS leaf
components ‖. (Wave 2) DS composite components ‖. (Wave 3) screens ‖. (Wave 4)
nav/layout + rip out tamagui dep/config/provider. (Wave 5) cleanup + final
green + review.

Critical sequencing note: tamagui dep/babel-plugin/provider removal (B14) MUST
come AFTER every `from 'tamagui'` import is gone (all DS + all screens + nav +
layout). Until then the `__mocks__/tamagui.js` stub and the dep stay so jest +
metro keep resolving. Theme module (B1) must land before any DS/screen batch.

### Wave 0 (parallel)

- **B0 — web/api/e2e teardown** (haiku). Pure deletions, no mobile-app source.
  Files: `apps/api/public/web/`, `apps/api/scripts/embed-web.mjs`,
  `apps/api/package.json` (build:web), `apps/api/next.config.mjs` (redirect/
  rewrite), `e2e/`, `playwright.config.ts`, root `package.json` (e2e scripts +
  @playwright/test devDep). Verify: `pnpm --filter api typecheck`,
  `pnpm --filter api test`. Parallelizable: yes. dependsOn: none.

- **B1 — theme foundation** (sonnet). Create `apps/mobile/theme/{colors,space,
  type,shadows,motion,usePressMotion,Text,index}.ts`. Values copied verbatim from
  `tamagui.config.ts` — **enumerate the FULL yum-theme alias map (§1.1 colors.ts)**,
  not a subset. `usePressMotion.ts` = Reanimated press hooks (`usePressScale`,
  `usePressNudge`) with the event-composition contract in §1.3b. `Text.tsx` =
  shared baseline-default Text wrapper + exported `textBase` style (§1.1b). Do NOT
  delete `tamagui.config.ts` yet (DS still imports it via mock indirectly; delete
  in B14). Verify: `pnpm --filter @yon/mobile typecheck` (theme compiles
  standalone). dependsOn: none. Parallelizable: yes.

### Wave 1 — DS leaf components (parallel, each disjoint file)

dependsOn: [B1]. Each: rewrite to plain RN + StyleSheet + `@/theme`, keep public
props, add `style?`. Verify after each: `pnpm --filter @yon/mobile test` (whole
suite stays green because barrel still exports same names; tamagui mock still
present for not-yet-migrated siblings).

**Not fully disjoint (Codex r2 CRITICAL-1/2):** the co-located callsite fixes mean
several Wave-1 batches reach into screen/composite files. B3 edits LibraryView/
TodoView/RecallView (Input `aria-label`); B4 and B5 BOTH edit `FoodCard.tsx`
(disjoint JSX blocks — B4 the `<Tag>` block, B5 the `<VerdictStamp>` block). To
avoid a concurrent same-file write on FoodCard.tsx, **run B5 after B4 (B5 dependsOn
[B1, B4])**, or assign both FoodCard edits to a single owner. The screen files B3
touches are NOT touched by any other Wave-1 batch, so those stay parallel-safe; the
Wave-3 screen batches (B11) rebase on B3's single-line edits.

- **B2 — Button + IconButton** (sonnet). `usePressNudge`. Files:
  `components/ds/Button.tsx`, `IconButton.tsx`. **Co-located callsite sweep
  (per §1.4b rule 2/3):** grep `aria-label=` on `<Button`/`<IconButton` across
  screens (AddModal dropzone, DetailView, others) and convert to
  `accessibilityLabel=` in the SAME batch — `aria-label` is not valid on the
  narrowed Button props. Also update any DS Button/IconButton test that asserts
  `aria-label` to assert `accessibilityLabel` (see §6 test list).
- **B3 — Input + Textarea** (sonnet). Collapse to single RN `TextInput`. Files:
  `components/ds/Input.tsx`, `Textarea.tsx`. KEEP `_FIELD_COLOR` export
  (`Input.test.tsx` imports it). Add Textarea test. **Co-located callsite sweep
  (Codex r2 CRITICAL-1):** B3 narrows `InputProps` to `TextInputProps`, which drops
  `aria-label`. Grep `aria-label=` on `<Input` across screens and convert to
  `accessibilityLabel=` in the SAME batch — confirmed callsites:
  `components/app/LibraryView.tsx:125`, `components/app/TodoView.tsx:82`,
  `components/app/RecallView.tsx:264` (single-line edits each; B11 migrates the rest
  of those files). Without this, per-batch tsc breaks at B3 because those screens
  don't migrate until Wave 3.
- **B4 — Tag + Badge + Avatar** (sonnet). Files: `components/ds/Tag.tsx`,
  `Badge.tsx`, `Avatar.tsx`, **`components/ds/FoodCard.tsx` (Tag callsite only)**.
  Tag adds `style?`. **Co-located callsite fix (Codex r2 CRITICAL-2):** move the
  `<Tag>` `position="absolute" top="$2" right="$2"` (FoodCard.tsx ~L161-164) into
  `style={{ position:'absolute', top:space[2], right:space[2] }}` — strict tsc
  rejects those excess props the moment Tag narrows; they do NOT ride `...rest`.
  FoodCard is the only external Tag callsite with position props (grep-verified).
  Surgical: touch only the Tag JSX block; B7 owns the rest of FoodCard.
- **B4b — Card** (sonnet). The public DS `Card` (`components/ds/Card.tsx`) is its
  OWN batch — it imports `tamagui` (`import { type GetProps, styled, View } from
  'tamagui'` L8) and `./animation` (`quick`), so it MUST be migrated explicitly or
  the B14 grep-zero gate cannot pass. (B7's FoodCard is a *different* file and does
  NOT migrate Card.) Rewrite to `View` / (interactive) `Pressable`→`Animated.View`
  + StyleSheet keyed by `variant/padded/interactive`. `backgroundColor:
  colors.backgroundStrong` (=`#ffffff`, white). `usePressNudge(quick)` x:2 y:2,
  shadow 5x5→3x3 on press, matching the current `quick` driver. Add `style?:
  StyleProp<ViewStyle>` (YouView/StatsView pass `marginTop`, StatsView passes
  `maxWidth`). File: `components/ds/Card.tsx`.
- **B5 — VerdictStamp + VerdictPicker** (sonnet). Files:
  `components/ds/VerdictStamp.tsx`, `VerdictPicker.tsx`,
  **`components/ds/FoodCard.tsx` (VerdictStamp callsite only)**. VerdictStamp adds
  `style?`. `usePressScale(bouncy)` on picker. **Co-located callsite fix (Codex r2
  CRITICAL-2):** move the `<VerdictStamp>` `position="absolute" top="$2" right="$2"`
  (FoodCard.tsx ~L175-177) into `style={{ position:'absolute', top:space[2],
  right:space[2] }}` — strict tsc rejects those excess props once VerdictStamp
  narrows. Surgical: touch only the VerdictStamp JSX block; B7 owns the rest. (B4
  edits the Tag block of the same file; the two blocks are disjoint, and both gate
  B7.)
- **B6 — Switch + Icon a11y** (sonnet). Switch: only `styled(View)` Track → RN
  `View`+StyleSheet; reanimated knob untouched. Use `accessibilityState={{ checked }}`
  (not `aria-checked`). File: `components/ds/Switch.tsx`. **Update test (§6.1.B):**
  `YouView.test.tsx:167,180,220` `aria-checked`→`accessibilityState.checked`
  (real-render, Switch not mocked there). **Icon a11y fix (Codex r2 CRITICAL-4):**
  `components/ds/Icon.tsx:43` emits `aria-label={label}` on the `<Svg>` (alongside an
  already-present `accessibilityLabel={label}` on L44). The B15 grep gate requires 0
  `aria-*` in mobile source, so SOME batch must own this. Delete ONLY the `aria-label`
  line (the `accessibilityLabel` line already covers RN a11y — no behavior change).
  This is the single Icon edit; the rest of Icon.tsx stays untouched. (Folded into B6
  to give the orphaned Icon fix an explicit owner without a new batch.)

### Wave 2 — DS composites (parallel)

dependsOn: [B1, B4, B5] (FoodCard uses Tag+VerdictStamp; both need `style?`, AND
B4/B5 already moved FoodCard's Tag/VerdictStamp `position` props to `style` — B7
must rebase on both, not run concurrently against FoodCard.tsx).

- **B7 — FoodCard** (sonnet). Keep Pressable render-prop + `pressed` manual
  scale/shadow; resolve tokens; expo-image unchanged. File:
  `components/ds/FoodCard.tsx`. The Tag/VerdictStamp position→style edits are
  ALREADY done by B4/B5 — do NOT re-touch those two JSX blocks; migrate the rest of
  the file (frame, Pressable, image, resolved tokens). Keep `FoodCardPress`/
  `FoodCardImage` tests green. dependsOn: [B1, B4, B5].
- **B8 — LangSwitcher** (sonnet). Drop web Portal/`document` branch; keep native
  Modal + FadeIn/Out + measureInWindow. `usePressScale(quick)`. File:
  `components/ds/LangSwitcher.tsx`. **Co-located callsite fix (Codex r2 CRITICAL-3):**
  B8 narrows the `tone` prop from a Tamagui token-string type to a resolved color.
  Two callsites pass `tone="$candyPink"`: `app/(tabs)/_nav.tsx:117` (migrates in B14)
  and `components/app/AuthScreen.tsx:124` (migrates in B12) — both AFTER B8. Convert
  BOTH to `tone={colors.candyPink}` in the SAME batch (single-line edits; their owning
  screen batches migrate the rest). Without this, per-batch tsc breaks at B8. B8's
  file list therefore adds `app/(tabs)/_nav.tsx` and `components/app/AuthScreen.tsx`.
  Keep `LangSwitcherFlag` test green.

After Wave 2: `components/ds/index.ts` updated if any type re-exports changed
(B7/B8 own it jointly — assign barrel edit to B8 to keep it single-writer).

### Wave 3 — screens (parallel, disjoint files)

dependsOn: [B1, B2, B3, B4, B4b, B5, B6, B7, B8] (all DS done, incl. Card/B4b).
B12 additionally rebases on B4b (B4b already touched the Card callsite lines in
YouView.tsx:324 / StatsView.tsx:283; B12 migrates the rest of those two files).
Mechanical swap +
web-branch removal per §3. Each screen verifies its own `__tests__`.

- **B9 — AddModal + PhotoPreview + AnimatedNumber** (sonnet). Remove hidden file
  input + web photo branch. All `<View onPress>`→`Pressable`; dropzone
  `aria-label`→`accessibilityLabel`. `AnimatedNumber` (Reanimated `Animated.Text`)
  applies `textBase` inline (§1.1b). Files: `components/app/AddModal.tsx`,
  `PhotoPreview.tsx`, `AnimatedNumber.tsx`. Keep `AddModalFooter.test.tsx`,
  `PhotoPreview.test.tsx` green. **Update tests (§6.1.B):**
  `AddModal.test.tsx:166` finder `{ 'aria-label':'Add a photo' }`→`accessibilityLabel`;
  AND **`AddModalDupBanner.test.tsx:264,289,346`** — the banner's dismiss View becomes
  a `Pressable` with `accessibilityLabel`, so the three finders keying on
  `props['aria-label'] === 'Cancel'` flip to failing; convert them to
  `props.accessibilityLabel === 'Cancel'` (Codex r2 MAJOR-1).
- **B10 — DetailView** (sonnet). Remove web sharing branch. File:
  `components/app/DetailView.tsx` (+ its tests stay green).
- **B11 — Library + Todo + Recall** (sonnet). `isDesktop`→`isWide`. Files:
  `components/app/LibraryView.tsx`, `TodoView.tsx`, `RecallView.tsx`.
- **B12 — You + Stats + TagManage + AuthScreen** (sonnet). AuthScreen drops web
  OAuth branch + MethodTab press hook. Files: `components/app/YouView.tsx`,
  `StatsView.tsx`, `TagManageView.tsx`, `AuthScreen.tsx`.
- **B13 — providers + AppGate + taste/[id]** (sonnet). Drop localStorage
  branches. Files: `providers/AuthProvider.tsx`, `I18nProvider.tsx`,
  `components/app/AppGate.tsx`, `app/taste/[id].tsx`. Keep `AuthProvider.test`,
  `I18nProvider.test` green.

### Wave 4 — nav/layout + tamagui removal

dependsOn: [B9..B13] (every `from 'tamagui'` import must be gone first).

- **B14 — nav/layout + rip out Tamagui** (opus — sequencing-sensitive, touches
  build config). Steps in one batch (single writer, no parallel):
  1. `_nav.tsx`, `_screen.tsx`: `useMedia`→`useWindowDimensions`, swap RN+theme.
     **Update tests (§6.1.A):** `AppNav.test.tsx:31` + `screen-motion.test.tsx:35`
     mock `useMedia` → rewrite to mock `useWindowDimensions` ({width,height}),
     driving `width` instead of `gtMd`. Grep `jest.mock\(['"]tamagui` across
     `apps/mobile` and convert each remaining one before step 4 deletes the mock.
  2. `_layout.tsx`: remove `global.css` import + `TamaguiProvider`/`Theme`.
  3. Grep `from 'tamagui'` and `tamagui.config` across `apps/mobile` → must be 0.
  4. Delete `tamagui.config.ts`, `components/ds/animation.ts`,
     `assets/global.css`, `__mocks__/tamagui.js`.
  5. `package.json`: remove 5 tamagui deps + react-dom + react-native-web +
     @expo/metro-runtime + `web` script. `babel.config.js`: drop plugin.
     `jest.config.js`: drop tamagui moduleNameMapper. `app.json`: drop web +
     baseUrl.
  6. `pnpm install` (lockfile update) — **flag to user** (CLAUDE.md: dep install
     is a gated op; do it in worktree only, never main).
  Verify: `pnpm --filter @yon/mobile typecheck`, `pnpm --filter @yon/mobile
  test`, and a metro bundle dry-run if feasible. dependsOn: B9–B13.
  Parallelizable: no.

### Wave 5 — final green + review

- **B15 — full verify + cross-model review** (sonnet to drive; Codex reviews).
  Run `pnpm typecheck` + `pnpm test` (both apps via turbo). Grep gates (all must
  be 0 / clean). **Gate commands MUST be source-scoped (Codex r2 MAJOR-3):** an
  unscoped `rg "...|aria-"` matches `pnpm-lock.yaml` (12 `aria-query`/`aria-hidden`
  package entries) and the `__mocks__/tamagui.js` stub, producing false positives
  that fail the gate even after all runtime uses are clean. Scope every gate to
  source: `--glob '*.tsx' --glob '*.ts' --glob '*.js' --glob '!pnpm-lock.yaml'
  --glob '!**/__mocks__/**'` (and run them only after B14 has deleted
  `__mocks__/tamagui.js`).
  1. `rg "tamagui|XStack|YStack|useMedia|\\$ink|\\$candy|aria-" apps/mobile
     --glob '*.tsx' --glob '*.ts' --glob '*.js' --glob '!pnpm-lock.yaml'
     --glob '!**/__mocks__/**'` → 0 (no tamagui refs, no leftover token strings,
     no `aria-*`). Note: `aria-*` includes the now-deleted Icon `aria-label`
     (B6) — re-confirm it's gone here.
  2. Alias-completeness (MAJOR-2): grep DS/screens for any color name NOT present
     in `theme/colors.ts` (catches a `colorMuted`/`borderColorSoft` etc. miss).
  3. Text-baseline (MAJOR-3): grep component/screen imports of `Text` from
     `react-native`; only `Animated.Text` allowed.
  4. Metro bundle dry-run (post-babel-plugin removal) — jest alone won't catch a
     metro-only break (fail-explicitly per CLAUDE.md).
  Cross-model Codex review on full diff before PR (per global rule), with §1.3b
  handler-forwarding/disabled-a11y as an explicit review checklist item.
  dependsOn: B14. Parallelizable: no.

---

## 6. Test strategy

Mechanism that keeps the suite green mid-flight:
- The DS **barrel `index.ts` keeps the same export names** at every step, so a
  half-migrated tree still imports fine.
- `__mocks__/tamagui.js` + the jest `moduleNameMapper` stay until B14. While any
  sibling still imports `tamagui`, the mock resolves it; migrated components
  import RN/theme directly (no mock needed). Both coexist.
- Migrated components render **real RN primitives** (`TextInput`, `Pressable`,
  `Image`, `View`) — which is exactly what the existing tests assert
  (`Input.test`, `FoodCardPress`, `FoodCardImage`, `LangSwitcherFlag`,
  `PhotoPreview`). These get *more* robust, not broken.

Per-batch verify commands:
- Theme/DS/screen batch: `pnpm --filter @yon/mobile test` and
  `pnpm --filter @yon/mobile typecheck`.
- API teardown (B0): `pnpm --filter api test`, `pnpm --filter api typecheck`.
- Final (B15): `pnpm test` + `pnpm typecheck` (turbo, both apps).

New tests to add (per CLAUDE.md "user-level feedback → unit test"):
- **Textarea**: mirror `Input.test.tsx` — assert real RN `TextInput`, concrete
  hex `#191017`, `multiline`, `textAlignVertical:'top'`. (Pins the same
  invisible-text regression class on the new single-path field.)
- **Button**: assert `accessibilityRole='button'`, press driver renders
  `Animated.View`, disabled sets `accessibilityState.disabled === true`, AND a
  caller-supplied `onPressIn` spy still fires (pins §1.3b rule 1 handler
  forwarding) — and does NOT fire when `disabled` (rule 2).
- **Tag**: assert caller `onPress` fires, `onPressIn` forwarding (§1.3b rule 1),
  and `style?` pass-through reaches the rendered node (pins FoodCard/AddModal
  position-via-style path).
- No snapshot tests exist (scan confirmed) → nothing to regen.

Existing tests to UPDATE (not add) — full enumeration + batch owner in §6.1:
`AppNav.test.tsx` + `screen-motion.test.tsx` (`useMedia`→`useWindowDimensions`,
B14); `YouView.test.tsx` (`aria-checked`→`accessibilityState.checked`, B6);
`AddModal.test.tsx` (`aria-label`→`accessibilityLabel` finder, B9);
`AddModalDupBanner.test.tsx` (three `aria-label`→`accessibilityLabel` finders, B9);
DS Button/IconButton tests asserting `aria-label` (B2).

Regression directions to verify explicitly (fail-old / pass-new):
- Input/Textarea text color stays `#191017` (would regress to invisible if a
  token string leaked back in).
- FoodCard tap still fires `onPress` (no double touch-responder) on the
  Pressable render-prop path.

Risk on tamagui mock removal (B14): the moment the mapper is dropped, any
*stray* surviving `from 'tamagui'` import becomes an unresolved-module test
failure — which is the desired tripwire. B14 greps to 0 before deleting the
mock.

### 6.1 Tests that break on tamagui-mock removal / aria→a11y (MAJOR-1) — explicit list

These are NOT covered by the "barrel keeps exports" mechanism; each must be
updated in the named batch (grep-verified locations):

**A. Tests that `jest.mock('tamagui', …)` / mock `useMedia` directly** — break at
B14 when the dep + moduleNameMapper are removed:
- `app/(tabs)/__tests__/AppNav.test.tsx:31` (`useMedia: () => mockUseMedia()`) →
  in **B14**, rewrite to mock `react-native`'s `useWindowDimensions`
  (`{ width, height }`) instead of `tamagui` `useMedia`. The component swap is
  `useMedia().gtMd`→`useWindowDimensions().width>=769`, so the test must drive
  width, not `gtMd`.
- `app/(tabs)/__tests__/screen-motion.test.tsx:35` (`useMedia: () => ({ gtMd:false })`)
  → same fix in **B14** (it tests `_screen.tsx`, also migrated in B14). Mock
  `useWindowDimensions` to a narrow width.
- Any other `jest.mock('tamagui')` — B14 greps `jest.mock\(['"]tamagui` across
  `apps/mobile` and converts each before deleting the mapper.

**B. Tests asserting Tamagui-era `aria-*` on REAL migrated DS output** — break when
the DS stops emitting `aria-*`:
- `components/app/__tests__/YouView.test.tsx:180,220` assert `Switch` props
  `aria-checked` → **B6 (Switch)**: RN Switch uses
  `accessibilityState={{ checked }}`; update assertions to
  `accessibilityState.checked` (and the L167 comment). YouView.test does NOT mock
  Switch, so this is a real-render assertion that flips with the Switch rewrite.
- `components/app/__tests__/AddModal.test.tsx:166` finds the photo dropzone by
  `{ 'aria-label': 'Add a photo' }` → **B9 (AddModal)**: dropzone becomes a
  `Pressable` with `accessibilityLabel`; update the finder to
  `accessibilityLabel`. (Per §1.4b, the dropzone is not a DS Button here, but the
  same aria→a11y rule applies.)
- `components/app/__tests__/AddModalDupBanner.test.tsx:264,289,346` (Codex r2
  MAJOR-1) find the banner close button by `props['aria-label'] === 'Cancel'` →
  **B9 (AddModal)**: the banner's dismiss View becomes a `Pressable` with
  `accessibilityLabel`, so all three assertions flip to failing. Convert each finder
  to `props.accessibilityLabel === 'Cancel'`. This is a real-render assertion (the
  banner is not mocked), so it must change in the same batch that migrates AddModal.
- Icon: **B6** drops Icon's `aria-label` line. Grep-verified: no Icon test exists
  and no DS test asserts `aria-label`, so this breaks nothing (the preserved
  `accessibilityLabel` keeps RN a11y intact). No test update needed.

**C. Tests that MOCK a DS component as a DOM `<input>`/`<textarea>`/`aria-label`** —
these mock the DS AWAY, so they keep passing *as-is* (the mock factory still
returns the same shape regardless of the real component). They do **not** need
changes for green, BUT they now assert against a fiction (the real Input renders
`TextInput`, not `<input>`). **Full grep-verified enumeration (Codex r2 MAJOR-2 —
the earlier list was incomplete and could mislead batch owners into skipping
files):** `AddModalTodo.test.tsx`, `DetailViewPromote.test.tsx`,
`LibraryView.test.tsx`, `LibraryViewStatus.test.tsx`, `TodoView.test.tsx`,
`VerdictJump.test.tsx`, `AddModalDupBanner.test.tsx`, `RecallRowPress.test.tsx`
(TextInput mock), `RecallView.test.tsx` (input mock ~L90), `RecallViewNearby.test.tsx`
(input mock ~L121), `RecallViewNearbyTodo.test.tsx` (input mock ~L131). These do
NOT block green today (the mock factory shape is stable), so they are not a gate;
the list is corrected only so batch owners don't wrongly assume completeness.
Recommendation: in the owning Wave-3 batch, swap each mock's `<input>`→a
`TextInput`-shaped mock + key on `accessibilityLabel`/`placeholder` so the test
reflects native reality (matches CLAUDE.md "PhotoPreview asserts real RN `<Image>`"
precedent). Flag to reviewer; not a green-gate blocker.

---

## 7. Risks

- **Hard pop-shadow on Android.** RN `shadowOffset` doesn't render on Android
  (elevation blurs). Today's code already accepts this (Android = border + x/y
  translate, no animated shadow). The rewrite preserves the *exact* current
  behavior — no visual regression, but Android still lacks the crisp offset
  shadow iOS shows. Not solvable with plain RN `View`; out of scope.
- **Input/Textarea single-path collapse** could differ subtly from today's
  iOS Tamagui field (loses iOS focus pop-shadow). Mitigated: matches Android
  reference, motion contract already scopes input focus shadow to iOS/web only,
  and iOS is "later" per mission. Pinned by Textarea/Input tests.
- **Dropped style-shorthand pass-through.** Any caller relying on Tamagui
  shorthands flowing through a DS component via `...rest` breaks at tsc time.
  Audit found Tag/VerdictStamp position props (handled via `style?`); a wider
  grep for `<Button …px=`, `bg=`, `mt=` on DS callsites must run in B2–B8 to
  catch stragglers. tsc is the safety net.
- **`pnpm install` in B14** rewrites the lockfile and is a gated op
  (CLAUDE.md). Must run only in the worktree; surface to user before running.
- **Metro/babel after plugin removal** — removing `@tamagui/babel-plugin` could
  surface a previously-masked transform. Jest skips the plugin already
  (NODE_ENV=test), so jest won't catch a metro-only break; B14/B15 should do a
  metro bundle dry-run, not rely on jest alone (fail-explicitly per CLAUDE.md).
- **EAS rebuild needed** — `EXPO_PUBLIC_API_URL` is build-baked; this refactor
  doesn't change the host, but a new APK must be built to ship the UI change.
  Out of scope for green-tests, flagged for release.
- **api `pg-mem` gaps** unchanged by this work; not a migration risk but the
  API teardown (B0) must not touch test DB wiring.
- **Incomplete alias inventory (Codex MAJOR-2).** If B1 copies only a subset of
  the `yum` theme aliases, mechanical migration silently substitutes wrong colors
  or hits undefined refs. Mitigation: §1.1 lists the FULL alias map from
  `tamagui.config.ts` L228-267; B1 must enumerate every key. A `colorMuted`/
  `colorFaint`/`borderColorSoft`/`backgroundStrong`/`success|warning|danger|info`
  miss is the likeliest silent regression — add a grep check in B15 that no DS/
  screen references a color name absent from `theme/colors.ts`.
- **Text baseline drift (Codex MAJOR-3).** RN `Text` has no inherited
  lineHeight/weight/letterSpacing. Mitigated by the shared `@/theme` `Text`
  wrapper (§1.1b); risk is a callsite importing bare `react-native` `Text` and
  losing the baseline. B15 greps `from 'react-native'` lines importing `Text` in
  components/screens — only `Animated.Text` callsites are allowed (they apply
  `textBase`). Font *family* is safe (both fonts are `System` = RN default).
- **Press-handler drop / disabled a11y regression (Codex MAJOR-4).** A naive
  driver wiring silently swallows caller `onPressIn`/`onPressOut` and skips
  `accessibilityState.disabled`. Mitigated by the §1.3b composition contract +
  forwarding/disabled tests on Button & Tag (§6). Reviewer must confirm every
  hook-driven DS Pressable composes caller handlers and sets the disabled a11y
  state — visuals looking correct does NOT prove handlers forward.
- **Test mock fictions (Codex MAJOR-1, §6.1.C).** Several screen tests mock DS
  inputs as DOM `<input>`/`<textarea>` and stay green while asserting against a
  non-existent web shape. They don't block green but mask native-render bugs;
  flagged to reviewer to convert to `TextInput`-shaped mocks in their Wave-3
  batches (low priority, not a gate).
