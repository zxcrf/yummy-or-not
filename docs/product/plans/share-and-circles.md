# Plan — 分享与口味圈子（S1 / S2 / S3）

> Roadmap 条目：P3。三期，每期独立可发布，顺序固定 S1 → S2 → S3。
> Private mode 的最终归宿在 S3：记录默认 private，可见性按条分享，
> You 页设置项变「新记录默认可见性」。S3 落地前 You 页该行隐藏。

## S1 — 卡片图片分享

**已实现**（#74）：DetailView 加「Share」入口，taste 卡片离屏渲染（专用分享版式：照片 + verdict 印章 + 名称/地点/价格 + app 品牌角标）→ `react-native-view-shot` 截图 → `expo-sharing` 系统分享面板。用户在系统面板自选微信/其他 app；照片是客户端本地渲染，不暴露 presigned URL。

**微信 SDK 直连暂不做**：需微信开放平台注册（¥300 认证）+ 应用审核 + 绑定 APK 包名与签名，上架后再接。

Web 端：已暂停维护（2026-06-10）。

## S2 — to-taste（想吃清单）

**已实现**（#75 API，#78 mobile）：tastes 加 status（'tasted'|'todo'），todo 无 verdict；AddModal 「还没吃，先记下」模式，Library 分 tab，DetailView 转正流程。
- `tastes` 加 `status text NOT NULL DEFAULT 'tasted'`：`'tasted'` | `'todo'`
- todo 记录无 verdict（schema 上 verdict 改可空，仅 status='todo' 时允许空）
- UI：
  - AddModal 加「还没吃，先记下」入口 → 简化表单（不强制 verdict/照片）
  - Library 加 tab 或 filter 区分 tasted / to-taste
  - to-taste 条目「吃完转正」：选 verdict（+ 可补照片/价格）→ status 翻成 tasted
- Stats / Recall 默认只算 tasted；Recall 可顺带提示「在你的想吃清单里」

### S2×L2 addendum — Recall 附近分组

Recall 空搜索态展示两个附近分组，**想吃优先**：
- `附近你想吃的`：todo 记录 + 坐标，cap **3**，按距离升序
- `附近吃过的`：tasted 记录 + 坐标，cap **5**，按距离升序

复用 haversine/formatDistance，client-side 过滤无新 API。单组为空时隐藏该分组头（符合既有逻辑）。

**转正 v1 不补照片**：`image` 列不可 PATCH（IDOR 边界），照片补传是后续任务。

## S3 — 口味圈子

最重一期，需服务端权限模型改动。仅记录方向级设计，动工前出细化 plan。

### 可见性

- `tastes` 加 `visibility text NOT NULL DEFAULT 'private'`：`'private'` | `'shared'`
- You 页「新记录默认可见性」设置（users 字段）
- 所有现有 API 不变行为（只返回本人数据）；跨用户读走新分享端点

### 分享与导入

- 分享 = 生成 share token / 链接，对方打开看到卡片**快照**
  （名称/地点/tags/照片副本或受控读授权——照片在私有桶，需复制到
  分享专用前缀或按 token 授权 presigned，细化时定）
- **导入**：对方一键复制快照进自己库，`imported_from` 记来源用户，
  落在对方 **to-taste**（status='todo'）——「朋友说好吃 → 我想去试」闭环，
  verdict 由对方吃了自己打
- 「圈子」形态（好友关系 / 群组 / feed）不在本期预设，先把
  单条分享-导入链路跑通，再看真实使用决定要不要社交结构

### 安全边界（细化时必须过）

- share token 不可枚举、可撤销、可设过期
- 照片授权不能把原 presigned URL 直接外发
- 导入是快照复制，源记录后续修改/删除不影响已导入副本

## 验证要点

- S1：截图版式多语言/长文案不溢出；Web 降级路径
- S2：todo 无 verdict 不破坏现有列表/统计/搜索；转正流程数据完整
- S3：token 撤销后立即失效；非 shared 记录任何旁路不可读（负向测试）
