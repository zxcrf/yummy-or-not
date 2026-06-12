# RN/Jest 异步泄漏与 CI exit-1 排查手册

> 来源:2026-06-12 排查记录。现象首发于 PR #82 合入后的 main,在 Tamagui→RN 迁移
> (PR #83)期间根治,修复见 PR #84 与 PR #83 内的后续提交。

## 症状

- GitHub Actions(Linux)上 `pnpm --filter @yon/mobile test`:**所有测试通过**
  (`Test Suites: N passed` / `Tests: N passed`),但 jest 进程退出码 1,
  turbo 报 `Failed: @yon/mobile#test`,日志里只有一行 `ELIFECYCLE Test failed.`。
- 本地 macOS 同一命令退出码 0 —— **本地通过不能作为此类问题的验证**。
- 日志中可能出现(也可能不出现)如下两种泄漏指纹:
  - `An update to <Component> inside a test was not wrapped in act(...)`
  - `ReferenceError: You are trying to `import` a file after the Jest environment
    has been torn down. From <suite>.tsx.`

## 机制(两类泄漏,修法不同)

测试结束后仍有"待触发的回调"会引用 React/模块系统。Linux CI 上该回调在 jest
环境销毁后才触发 → worker 崩溃 → 退出码翻 1(测试结果已经汇报完,所以全绿)。
macOS 上事件循环时序不同,回调通常在销毁前被排干 —— 纯竞态,所以"本地不复现"。

### 类型 A:真实 timer

组件 mount 即武装 `setTimeout`(例:`RecallView` 的 250ms 搜索 debounce,
**每次 mount 都会武装**,不需要打字)。套件没开 fake timers、也不 unmount →
套件结束后真实 timer 开火,`setState` 落在已销毁的环境里。

修法:`jest.useFakeTimers()` + `afterEach(() => { act(() => jest.runAllTimers());
act(() => mountedRenderers.forEach(r => r.unmount())) })`。
unmount 会触发 effect cleanup(`clearTimeout`),本身就能消解 debounce。

### 类型 B:promise continuation(fake timers 救不了)

组件 mount 即发起异步调用并在 `.then` 里 `setState`(例:`DetailView` 的
`Sharing.isAvailableAsync().then(setSharingAvailable)`)。套件用**同步**
`act(() => TestRenderer.create(...))` 挂载 → continuation 在 act 外 resolve →
React 调度真实 macrotask → 套件结束后开火;若重渲染撞上 render 时才
`require()` 的 mock,直接抛 "import after teardown"。

修法(双侧):
1. 测试侧(决定性):mount 改 `await act(async () => { ... })`(把 continuation
   排干在 act 内)+ `afterEach` 统一 unmount。
2. 组件侧(卫生):async effect 加 alive-flag cleanup ——
   `let alive = true; ...then(v => { if (alive) set(v) }); return () => { alive = false }`。

## 确定性本地代理(关键)

Linux exit-1 本身不可在 mac 复现,但 **act 警告数是它的确定性代理**:

```bash
pnpm --filter @yon/mobile exec jest <suites> --no-coverage 2>&1 | grep -c "not wrapped in act"
# 必须为 0。本次排查中警告数 = mount 数 − awaited 数,精确吻合。
```

写新测试 / 改挂载方式后,跑这条即可,无需等 CI。

## Linux 真实复现(需要时)

```bash
STORE=$(pnpm store path)
docker run --rm -v "$(pwd)":/src -v "$STORE":/pnpm-store -w /tmp node:22 bash -c "
  git clone -b <branch> /src repo >/dev/null 2>&1 && cd repo &&
  corepack enable && pnpm config set store-dir /pnpm-store &&
  pnpm install --frozen-lockfile >/dev/null 2>&1 &&
  cd apps/mobile && ../../node_modules/.bin/jest --no-coverage; echo EXIT:\$?"
```

要点:容器内 clone(别复用宿主 node_modules),挂载 pnpm store 提速。

## 新测试检查清单

- [ ] mount 一律 `await act(async () => { renderer = TestRenderer.create(...) })`。
- [ ] 每个 renderer 推入 `mountedRenderers`,`afterEach` 里 act 内全部 unmount。
- [ ] 被测组件 mount 即武装 timer 的(debounce/轮询),套件开 fake timers 并在
      afterEach flush。
- [ ] 组件里的 async effect 必须有 alive-flag 或 AbortController cleanup;
      timer effect 必须 clearTimeout/clearInterval。
- [ ] 套件级验证:act 警告 grep = 0。
- [ ] **禁止 `--forceExit`** —— 它把泄漏从"CI 红"变成"静默带病",违反
      fail-explicitly 原则。

## 同场排查附带的坑(简记)

- **turbo 日志误导**:失败任务的分组头被整体染红,真正的信号是末尾
  `Failed: @yon/<pkg>#test`;两段 `ELIFECYCLE` 分别来自包内 pnpm 与根 pnpm。
- **strict tsc + 收窄 props**:把组件 props 从宽(Tamagui styled)收窄为
  `ViewProps`/`PressableProps` 后,调用点上的多余 JSX props(`position`、
  `aria-label`、`marginTop` shorthand)**立刻**编译失败 —— 不存在 `...rest`
  吸收宽限期。迁移批次必须与调用点修改同批落地(详见
  `docs/product/native-ui-migration.md` §1.4b)。
- **merge 的语义冲突**:两分支各自进化同一个测试 helper(一边按组件引用找
  `ScrollView`,一边按字符串找),git 文本冲突解掉后测试照样挂 —— 跨分支合并
  测试基建后必须重跑全量,不能只看冲突标记消失。
