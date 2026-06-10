# Yummy or Not — Roadmap（演进方向）

本文件只记录**演进方向与优先级**。具体设计、数据模型、交互细节放在
`docs/product/plans/` 下的独立 plan 文档，条目用 📄 指向。

状态标记：`[ ]` 未开始 · `[~]` 部分实现 · `[x]` 已完成（保留一个版本周期后删除）

---

## P0 — 当前主线

### [ ] 全局统一搜索
吃了什么 / 在哪里 / 看法（notes）混合检索，按相关性评分排序。先做内存评分
实现（个人数据量级足够），接口可替换，未来需要时再换 FTS5 引擎。
Library / Recall / Add 同名检测共用同一套搜索函数。
📄 [plans/unified-search-and-tags.md](plans/unified-search-and-tags.md)

### [~] 用户自定义 Tag 库
AddModal 已支持输入自定义 tag（仅作用于当条记录）。缺：用户级 tag 库持久化、
Library filter chips 改读用户 tag 库（替代硬编码 FILTERS）、You 页管理入口。
📄 [plans/unified-search-and-tags.md](plans/unified-search-and-tags.md)

### [ ] 小项清理
- Recall 「最近回忆」卡片数量按设备视口高度动态适配（现硬编码 4 条）
- 「你的口味」文案改「我的口味」（5 locale）

## P1 — 数据完整性 + 体验

### [ ] 重复购买提醒
warn 开关持久化（现仅前端 state）+ 三个触发场景：Recall 命中警示、
Add 同名检测 inline 提示、+1 Again 确认。不做 push。
购买升级为流水表（taste_purchases），boughtCount 改派生值，支持不同地点/价格。
Recall 搜索返回全部相关结果（替代原 R02：`items.find()` 只取第一条）。
📄 [plans/repurchase-warning.md](plans/repurchase-warning.md)

### [ ] Stats 数字动画
统计数字已实时（API + 本地 fallback），补加载完成后 0 → 目标值的
翻牌/滚动动画（reanimated）。金额走 formatMoney，符号不参与滚动。

## P2 — 个性化

### [ ] You 页全区域可交互
- verdict 磁贴 / 省钱卡 / taste 计数 → 跳转 Stats / Library 存量页（零开发）
- Warnings 行 → 全局提醒开关（依赖重复购买提醒落地）
- Location 行 → 定位记录开关（见下）
- Private mode 行 → S3 圈子前隐藏，落地后变「新记录默认可见性」
- Tag 管理入口（依赖 Tag 库）

### [ ] 头像 / 昵称编辑
PATCH user API + 编辑页。（原 R06）

### [ ] 位置：L1 + L2，永不做 L3
L1：Add 时一次性前台定位，自动填 place / 存坐标。
L2：Recall 按距离排「附近吃过的」。
L3（geofencing + push 主动提醒）已决议**永久砍掉**。
📄 [plans/location.md](plans/location.md)

## P3 — 分享与圈子（分三期，每期独立可发布）

### [ ] S1 卡片图片分享
taste 卡片客户端渲染成图 → 系统分享面板（用户自选微信）。
微信 SDK 直连等上架后再接（需开放平台注册 + 审核）。

### [ ] S2 to-taste（想吃清单）
tastes 加 status（tasted / todo），todo 无 verdict，吃完转正。
单机即有价值，且是 S3 导入功能的落点。

### [ ] S3 口味圈子
记录默认 private，可分享卡片快照给他人；对方可导入到自己的
to-taste（带 imported_from）。需服务端权限模型改动，最重，最后做。
📄 [plans/share-and-circles.md](plans/share-and-circles.md)

## P4 — 远期保留

### [ ] 离线支持（原 R07）
本地缓存 + 离线队列 + 上线同步。统一搜索若未来换 FTS5（expo-sqlite），与此项同基建。

### [ ] 数据导出（原 R09）
CSV / JSON 导出，或可视化报告。

---

## 已完成 / 已合并（上版本 roadmap 清账）

- [x] R01 编辑味道记录 — DetailView 编辑模式已实现
- R02 Recall 返回全部匹配 → 并入「重复购买提醒」plan
- R03 Warn 开关持久化 → 并入「重复购买提醒」plan
- R04 购买次数递增 → 升级为购买流水表，并入「重复购买提醒」plan
- R05 设置项功能 → 拆解进「You 页全区域可交互」「位置」「圈子」
- R08 分享 → 细化为 S1–S3 三期
