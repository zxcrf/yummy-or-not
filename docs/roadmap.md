# Yummy or Not — Roadmap（待实现功能）

从用户故事审查中识别出的待实现功能，按优先级排列。

## P0 — 核心功能缺失

### R01 编辑味道记录
- **现状**：DetailView 有 Edit 按钮 UI，但未接通任何编辑逻辑
- **影响**：用户记录有误时无法修改，只能删除重建
- **需要**：编辑表单（复用 AddModal）、PATCH `/api/tastes/{id}` 已有后端支持
- **涉及**：`DetailView.tsx`、`AddModal.tsx`（改造为 Add/Edit 双模式）

### R02 Recall 搜索返回全部匹配
- **现状**：`items.find()` 仅返回第一条匹配
- **影响**：用户在不同地方吃过同名食物，只能看到第一条
- **需要**：改为 `items.filter()`，展示匹配列表

## P1 — 数据完整性

### R03 Warn 开关持久化
- **现状**：DetailView 的「Warn me before I buy again」开关仅前端 state，刷新/重进丢失
- **影响**：用户设置的警告无实际效果
- **需要**：DB 加字段 `warn_before_buy boolean` 或存储在 tastes 表；API PATCH 支持更新

### R04 购买次数递增
- **现状**：`boughtCount` 始终为 1（创建时默认），UI 展示但无递增入口
- **影响**：用户无法记录多次购买同一食物
- **需要**：Detail 页添加「+1」按钮，调用 PATCH `incrementBought`（API 已支持）

## P2 — 设置与个性化

### R05 设置项功能
- **现状**：You 页 3 个设置行（Warnings / Location / Private mode）仅 UI 占位
- **影响**：用户点击无响应
- **需要**：
  - Warnings：全局提醒开关（配合 R03）
  - Location：基于位置的店铺推荐/关联
  - Private mode：味道记录默认可见性

### R06 用户头像/昵称编辑
- **现状**：You 页显示头像和昵称，但无编辑入口
- **影响**：注册后无法修改个人信息
- **需要**：编辑 profile 页面，PATCH user API

## P3 — 增强体验

### R07 离线支持
- **现状**：所有操作依赖网络请求
- **影响**：无网络时完全不可用
- **需要**：本地缓存 + 离线队列 + 上线同步

### R08 分享功能
- **现状**：无分享入口
- **需要**：分享单条味道记录到社交平台（图片 + 文案）

### R09 数据导出
- **现状**：数据仅存服务器
- **需要**：导出为 CSV / JSON，或生成可视化报告
