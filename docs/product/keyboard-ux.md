# Keyboard & IME UX — 键盘交互设计准则

当用户聚焦输入框、软键盘从底部升起时，可视区域/可操作区域如何变化。
适用于所有含输入框的页面（AddModal、AuthScreen、Recall 搜索、未来表单）。

姊妹文档：[material-motion.md](./material-motion.md)（按压/过渡动画）、
[platform-differences.md](./platform-differences.md)（Web vs Mobile 行为矩阵）。

## 三种基本策略

| 策略 | 行为 | 评价 |
|---|---|---|
| **Resize** | 窗口高度缩小，布局重排到键盘上方 | 传统 Android `adjustResize`；功能正确但默认无动画（跳变） |
| **Pan** | 窗口整体上移露出光标，顶部内容被推出屏幕 | `adjustPan`；遗留方案，禁用 |
| **Overlay + inset 动画** | 键盘浮在内容上方，app 监听 ime inset 逐帧跟随 | **现代最佳实践**；iOS 一直如此，Android 11+ (`WindowInsetsAnimation`) 支持 |

## 平台原生行为（为什么 Android 感觉割裂）

**iOS**：键盘是独立 window，永远 overlay。系统通过 `keyboardWillShow`
通知下发**精确动画参数**（duration + 专用 spring curve），app 用同样参数
动画化 `contentInset`（iOS 15+ `keyboardLayoutGuide` 自动跟踪）。
全系统同一套参数 → 体感一致。

**Android** 割裂有三层：

1. 每个 Activity 自选 `windowSoftInputMode`（resize/pan/nothing）——不同页面模式不同。
2. `adjustResize` 在 API 30 前是同步一帧跳变，键盘却滑 ~250ms——内容与键盘运动不同步。
3. API 30+ 的 `WindowInsetsAnimation` 可逐帧跟随，但需主动接入，多数 app（和 RN 默认）没接。

叠加第三方键盘（Gboard/Samsung/搜狗）高度与动画曲线各异。

## 本项目准则

1. **逻辑视口 = 屏幕 − 键盘**。聚焦的输入框和主操作按钮必须始终在键盘上方可见。
2. **布局变化必须与键盘动画同步**，目标是逐帧跟随，至少是同 duration 的动画，绝不允许一帧跳变。
3. **焦点输入框自动滚入视口**，键盘上方留 ≥16dp 余量；光标永远可见。
4. **主操作按钮（保存/提交）做 sticky footer**，跟随 ime inset 平移，贴在键盘正上方。
   不允许"收起键盘才能点提交"。AddModal 的 action footer 已是此模式（PR #68）。
5. **顶部内容允许压缩/滚出**，但导航/关闭入口保留。
6. **收起方式**：点击表单空白处收起；可滚动列表场景用 `keyboardDismissMode`
   （聊天/搜索类用 `interactive`）。
7. **禁止**：`adjustPan`；键盘盖住正在编辑的字段；footer 被键盘吞掉；
   每个页面独立拼 `KeyboardAvoidingView` 参数。

## 当前实现状态（2026-06）

| 页面 | 现状 | 问题 |
|---|---|---|
| AddModal | `KeyboardAvoidingView behavior="padding"`（两端），edge-to-edge 下键盘浮于内容，手动 `scrollTo` 把底部字段滚入视口；action footer sticky | padding 值跳变无动画；scroll 补偿是手写的 |
| AuthScreen | `behavior={ios ? 'padding' : 'height'}` | 与 AddModal 策略不一致；Android `height` 即 resize 跳变 |
| Recall 搜索 | 无键盘处理（搜索框在页面顶部，天然可见） | 列表未做 `keyboardDismissMode` |

两个页面两种策略 = 用户感知的"不同页面键盘行为割裂"。

## 目标方案

统一迁移到 **`react-native-keyboard-controller`**（社区标准）：

- 底层 Android 用 `WindowInsetsAnimation`、iOS 用 keyboard notifications，
  两端逐帧 1:1 同步。
- `KeyboardAvoidingView`（库内同名组件）直接替换 RN 内置版，行为一致且有动画。
- `useKeyboardAnimation` 提供逐帧 `height/progress` shared value，
  sticky footer 的 translateY 直接绑定它。
- 支持 interactive dismiss。

迁移后删除所有 `Platform.OS` 键盘分支和手写 scroll 补偿。
新页面一律使用库组件，禁止再引入 RN 内置 `KeyboardAvoidingView`。

## 验收清单（任何含输入框的 PR）

- [ ] 聚焦每个输入框：字段 + 光标在键盘上方可见
- [ ] 主操作按钮在键盘升起时仍可点击
- [ ] 键盘升/降过程内容平滑跟随，无一帧跳变
- [ ] Android 真机（edge-to-edge）+ iOS 各验一遍
- [ ] 旋转/小屏（~640dp 高）下不丢失关键控件

## 修订 2026-06-16 — 统一 EditActionHeader 顶部操作栏（见 ADR 0001）

可编辑 / 命令类屏幕现在统一使用共享组件 `EditActionHeader`（顶部操作栏）：
- **取消恒定在左上**，**主命令（保存 / 查找 / import）恒定在右上**，标题居中。
- 标题是绝对定位、`pointerEvents: 'none'` 的层，宽度不均时仍视觉居中，且不抢侧边
  按钮的点击。

这调整了上文规则 #4「主操作按钮做 sticky footer，跟随 ime inset」的适用范围：

- **全屏 / 路由屏幕**：去掉底部 sticky footer，主命令改放顶部操作栏。顶部栏永远不会
  和键盘重叠，反而把视口让回给内容（解决 AddModal 视口被底部 footer + 键盘双重挤压
  的问题）。带 safe-area 顶部 inset + 3px 底边框。
- **底部 sheet**（已废弃）：操作行曾放在 `KeyboardStickyView` 子树内、位于 sheet 顶部。

即规则 #4 的「sticky footer 跟随键盘」此后由顶部 EditActionHeader 承担主命令。
详见 `.ai/adr/0001-edit-action-header.md`。

## 修订 2026-06-17 — 取消 `sheet` 形态，全部编辑表单改全屏（见 ADR 0001 Amendment）

原方案的 `EditActionHeader` 有 `screen` / `sheet` 两个 variant。现已移除 `sheet`：
五个编辑表单（记录口味 / 编辑 / 编辑昵称 / 家人 / 标签重命名）统一为全屏 `Modal`，
采用 AddModal 模式（顶部固定 `EditActionHeader` + `KeyboardAwareScrollView`，
`bottomOffset={16}`，内容 `paddingBottom: insets.bottom + 16`）。**任何编辑表单都
不再使用 `KeyboardStickyView`**——规则 #4 的「sticky footer 跟随键盘」对所有编辑表单
均不再适用，主命令一律由顶部操作栏承担。

配套：新增共享 `ConfirmSheet`（绝对定位 overlay，非嵌套 Modal），所有编辑表单在
未保存改动时点取消会先确认（点击暗色区 = 继续编辑）。
