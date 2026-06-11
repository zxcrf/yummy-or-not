# Yummy or Not — 已知问题

从代码审查和用户故事推演中发现的 bug 和缺陷。

## Bug

### BUG-01 已修复 — Recall 只返回首条匹配
已修复：`RecallView.tsx:189-192` 改为 `items.filter()` 渲染全部匹配。

### BUG-02 已修复 — Warn 开关不持久化
已修复：`warn_before_buy` 持久化至后端（migration 0004），`DetailView.tsx:233-250` 读写。

### BUG-03 已修复 — Edit 按钮无功能
已修复：`DetailView.tsx:180-231` 编辑模式完全实现。

### BUG-04 已修复 — 设置项不可交互
已修复：verdict 磁贴、Warnings 行、Location 行、Tag 管理入口已实现；Private 行隐藏至 S3；省钱卡 / 计数跳转已实现。

## 潜在问题

### RISK-01 已标注 moot — Web 端删除确认体验差
Web 维护已暂停（2026-06-10），该风险不再适用。

### RISK-02 已修复 — YouView displayName fallback
已修复：`YouView.tsx:63-72` `deriveDisplayName()` 实现 displayName → email local-part → Foodie+phone → default_name fallback。

### RISK-03 保留 — FoodCard tags 兼容性解析
`normalizeTags` 仍存在（`FoodCard.tsx:73`，db.ts:205/240-253），dirty-data 迁移未做，暂保留运行时兼容。
