# Plan — 分享与口味圈子（S1 / S2 / S3）

> Roadmap 条目：P3。S1/S2 已发布。S3 原为方向级 stub，本文档把它细化为
> 三个独立可发布子期 **S3a → S3b → S3c**，顺序固定（S3c 的 family/member
> 定向依赖 S3b）。
> Private mode 的最终归宿在 S3c：记录默认 private，可见性按条分享，
> You 页设置项变「新记录默认可见性」。S3c 落地前 You 页该行隐藏。

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

---

# S3 细化 — 三子期

> 决策已锁定（2026-06-13；geo / 存储两项经 review 翻修）：
> - **Geo 查询引擎**：装 **PostGIS**（geography + GiST），用于**跨用户 geo feed
>   半径查询**（`ST_DWithin`）。geohash 网格**并存**，但只负责两件事：公开热力图
>   聚合（`GROUP BY grid_cell`）+ 显示层坐标粗化（隐私）。两者正交：geohash=显示/
>   隐私，PostGIS=查询引擎，非二选一（这是上一版的错误框定）。
>   - 自托管 PG17 Docker：换 `postgis/postgis` 镜像 + migration `CREATE EXTENSION
>     postgis`；备份/恢复需含扩展。portability 不再是顾虑（已无 Neon）。
>   - **本人记录的「附近」（口味/想吃）维持客户端**（见 PR #90 `sortByNearest`）：
>     个人量级（free cap 100）、离线、零延迟，不回退成服务端往返。PostGIS **只**进
>     跨用户场景（客户端拿不到别人的数据）。
> - **分享存储**：share_tokens 只存**瘦指针**，无 jsonb 快照、mint 时**不复制照片**。
>   预览走 token 闸门的**原图短期 presign**（复用现有 R2 presign），**导入时才复制**
>   照片到导入方库（仅真导入才复制一次，非每次分享）。详见 S3a。
> - **Taster 模型**：persona 无登录（owner 账号下的轻量档案），**不做真实账号
>   互联**。完美匹配「对方没有 app」。真实账号 family 互联留后续。
> - **Plan 分层**：保留 `plan ∈ free|pro`，**不扩 enum**。pro 解锁 family/多
>   taster。live photo / mini video 走**新增能力位**（pro 升级档），独立子期。
>
> **PR #90 对齐**：#90 把「回忆」并入「口味菜单」（LibraryView 统一入口 +
> RecallResults，删 RecallView），距离排序为客户端 `useUserCoords`/`sortByNearest`。
> 故下文 S2×L2 与 S3c 涉及的「Recall 页/分组」一律落到 **LibraryView/RecallResults**，
> 本人「附近」复用 #90 的 `useUserCoords`/`sortByNearest`，不重造。

每个子期独立 PR，独立 migration（编号续 0007…），独立可上线。

## S3a — 单条分享 → 导入 to-taste（你的 Req 1）

最小、最高价值、无新大概念。直接接 S1 卡片 + S2 to-taste。

### 机制

当前 S1 只分享 PNG 图片，无数据回链。S3a 让分享 payload **同时带回链**：
- 主路径：`expo-sharing` 文本里附 deep link `yummyornot://import/<token>`，
  对方点开 → app 拉**预览**（live read + 原图短期 presign）→ 一键存入自己的 to-taste。
- **降级路径（"magic word"）**：卡片上印一个短**导入码**（不可枚举、token 派生
  的 6~8 位）。微信转发图片会吃掉链接，对方在 app 里输/粘这个码即可导入。
  → 这就是你说的「metadata/magic word 触发保存至 to-taste」。

deep link 已有基建：OAuth 回调用的就是 `yummyornot://`（见 oauth deeplink 测试）。
新增 `import/<token>` route 即可，不需要 universal link 认证链路。

### 数据模型（migration 0007）

**瘦指针，不存快照、不复制照片**（review 翻修）：

```sql
CREATE TABLE share_tokens (
  token       text        PRIMARY KEY,            -- 不可枚举（crypto 随机）
  taste_id    text        NOT NULL REFERENCES tastes(id) ON DELETE CASCADE,
  owner_id    text        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  revoked     boolean     NOT NULL DEFAULT false,
  expires_at  timestamptz,                        -- null=不过期（owner 可后改撤销）
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX share_tokens_owner_idx ON share_tokens (owner_id, created_at DESC);

CREATE TABLE taste_imports (
  id           text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  taste_id     text        NOT NULL REFERENCES tastes(id) ON DELETE CASCADE,  -- 导入方库里新建的副本
  from_token   text        REFERENCES share_tokens(token) ON DELETE SET NULL,
  from_user_id text        REFERENCES users(id) ON DELETE SET NULL,           -- 来源（provenance）
  importer_id  text        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (from_token, importer_id)               -- 同 importer 同 token 幂等
);
CREATE INDEX taste_imports_importer_idx ON taste_imports (importer_id, created_at DESC);
```

> **无 jsonb 快照**：预览时按 `taste_id` live read 源记录（owner 改了就显示新值，
> 预览本就是临时的）。**快照语义在导入时才兑现**——import 把当时的字段 + 照片
> **复制**进导入方库，从此与源解耦（源改/删不影响已导入副本）。省掉每条分享的
> jsonb 存储与 mint 时的照片副本。

### 端点

- `POST /api/tastes/:id/share` → mint token（owner 自有记录）。只写一行瘦指针。
  返回 `{ token, deepLink, importCode, expiresAt }`。
- `GET  /api/share/:token` → 校验 token（未 revoked/未过期）→ live read 源 taste →
  返回字段 + **原图短期 presign（≤60s）**。revoked / 过期 / 源已删 → 410 Gone。
- `POST /api/share/:token/import` → 登录用户复制进自己库：新建 `status='todo'`、
  `verdict=null` 行，**此时把照片复制进导入方存储命名空间**（真导入才复制一次）
  + 写 `taste_imports` provenance。重复导入同 token 命中 UNIQUE → 返回已存在副本。
- `DELETE /api/tastes/:id/share`（或 PATCH revoked）→ owner 撤销。

### 照片边界（安全）

- **绝不外发 owner 的原 presigned URL**。可分享的是 **token**（`yummyornot://import/<token>`），
  不是裸 presigned URL。预览读经过 API 闸门：校验 DB `revoked/expires` → 才 mint
  一个 **≤60s** 的原图 presign。presign 短期 + 每次读现 mint，所以撤销立即生效
  （DB 一标记，API 拒绝再发 presign）。
- **复用现有 R2 presign 基建**（`lib/storage.ts`，同 `/api/tastes/:id/original` 路径），
  mint 时**不复制照片**，零额外存储。
- **导入才复制**：`POST import` 把照片复制进导入方命名空间——此后导入副本独立，
  源删/改不影响。复制次数 = 真导入次数（≪ 分享次数）。

### UI 面（mobile）

- DetailView Share 入口：现「系统分享图」旁/下加「分享给朋友（可导入）」→
  调 mint，把 deepLink + importCode 拼进系统分享文本，仍带 PNG 卡片。
- 新增 import 落地页：deep link `import/<token>` 或 You 页「输入导入码」入口 →
  预览卡片 → 「存入我的想吃」按钮 → 调 import → 跳 Library todo tab。

---

## S3b — Taster 切换 + Family plan 容器（你的 Req 2）

「一个人有 app，另一个没有，帮 ta 记录口味」→ taster = **owner 账号下的 persona**，
无独立登录。

### 数据模型（migration 0008）

```sql
CREATE TABLE families (
  id         text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  owner_id   text        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       text        NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX families_owner_idx ON families (owner_id);

CREATE TABLE tasters (
  id               text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  owner_account_id text        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  family_id        text        REFERENCES families(id) ON DELETE SET NULL,
  display_name     text        NOT NULL,
  avatar           text        NOT NULL DEFAULT '',
  is_self          boolean     NOT NULL DEFAULT false,  -- owner 本人的默认 taster
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tasters_owner_idx ON tasters (owner_account_id);

-- tastes 归属到 taster（可空：旧数据/默认=owner 的 self-taster，回填）
ALTER TABLE tastes ADD COLUMN IF NOT EXISTS taster_id text REFERENCES tasters(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS tastes_taster_idx ON tastes (taster_id, created_at DESC);
```

> 迁移回填：为每个现有 user 建一个 `is_self=true` taster，把其 tastes 的
> `taster_id` 指过去。新用户注册时自动建 self-taster。

### 行为

- **active taster** = 客户端选择态（持久化在 app）。POST /api/tastes 带 taster_id；
  不带则落 self-taster。
- Library / Stats / Recall 可按 taster 过滤（顶部加 taster 切换器；self 默认）。
- **权限**：taster CRUD 仅 `plan='pro'`（你说 pro≡family）。free 用户只有 self-taster，
  切换器隐藏。服务端在 POST/PATCH taster 处校验 plan，**不靠客户端**。
- `families` 本期作为 taster 容器即可（owner 一个 family，下挂多 taster）；
  真实账号互联（邀请/接受/跨账号读）**不在本期**，family_members 真实 user 绑定留后续。

### 端点

- `GET/POST/PATCH/DELETE /api/tasters` — persona CRUD（pro gated）。
- `GET /api/tastes?taster=<id>` — 现有列表加 taster 过滤参数。
- self-taster 不可删（is_self 保护）。

### S3b-media — live photo / mini video（pro 升级档，独立子拆）

**不阻塞 taster/family**，单独排期。

- 能力位：`ALTER TABLE users ADD COLUMN media_enabled boolean NOT NULL DEFAULT false`
  （pro 升级档；不扩 plan enum）。free/普通 pro = false。
- 存储：R2 已有照片 + 变体基建。video 增量 = 大对象 + **封面帧提取**（poster）
  + 播放（expo-video）+ 上限（时长/体积 cap）。live photo = 静图 + 短 mov，
  按 video 同管线处理。
- 真实工作量在媒体管线（转码可先跳过、限制源格式），故独立子期，先 taster 后 media。

---

## S3c — Geo 可见性 + 网格热度（你的 Req 3）

最重。可见性超出原 stub 的 private|shared 布尔 → **定向发布**（geo / family / member）。

### 数据模型（migration 0009）

**前置 migration 0009a**：`CREATE EXTENSION IF NOT EXISTS postgis;`（换 `postgis/postgis`
镜像后）。

```sql
-- 默认可见性（按条覆盖）
ALTER TABLE tastes ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'private'
  CHECK (visibility IN ('private','shared'));   -- 'shared'=至少有一条定向发布
ALTER TABLE users  ADD COLUMN IF NOT EXISTS default_visibility text NOT NULL DEFAULT 'private'
  CHECK (default_visibility IN ('private','shared'));

-- 定向发布：一条 taste 可同时发布到多个目标
CREATE TABLE taste_shares (
  id          text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  taste_id    text        NOT NULL REFERENCES tastes(id) ON DELETE CASCADE,
  owner_id    text        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type text        NOT NULL CHECK (target_type IN ('geo','family','member')),
  target_id   text,                              -- family_id / member（=taster_id 或未来 user_id）；geo 时 null
  -- geo 发布双写：geog 给 PostGIS 半径查询，grid_cell 给热力聚合 + 显示粗化
  geog        geography(Point,4326),             -- 仅 geo 发布；ST_DWithin 半径查询
  grid_cell   text,                              -- geohash precision 5（仅 geo；粗化坐标=隐私）
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX taste_shares_geog_idx  ON taste_shares USING GIST (geog) WHERE target_type='geo';
CREATE INDEX taste_shares_grid_idx  ON taste_shares (grid_cell)       WHERE target_type='geo';
CREATE INDEX taste_shares_target_idx ON taste_shares (target_type, target_id);
```

> **geog vs grid_cell 分工**：同一 geo 发布**双写**两列。`geog` 喂 PostGIS 做连续
> 半径查询（「我附近 R km 的公开口味」）；`grid_cell` 喂热力图聚合 + 决定**对外
> 显示的粗化位置**。两者正交、不冲突。

### Geo 查询（PostGIS）+ 网格热度（geohash）

- **半径 feed（PostGIS）**：`SELECT … FROM taste_shares
  WHERE target_type='geo' AND ST_DWithin(geog, :me, :radius_m)`。GiST 索引，跨用户
  规模可扩。这是 geohash 桶做不了的连续半径查询，也是装 PostGIS 的唯一硬理由。
- **热力图（geohash）**：`SELECT grid_cell, COUNT(*) FROM taste_shares
  WHERE target_type='geo' GROUP BY grid_cell`。多=hot 少=cold。
- geohash 编解码放 `packages/shared/src/geo.ts`（已有 haversine/gcj02，同文件加
  `encodeGeohash`/`decodeGeohashBounds`，纯函数可单测）。
- **本人记录的「附近」不走这里**：口味/想吃菜单的附近排序仍是 PR #90 的客户端
  `useUserCoords`/`sortByNearest`（个人量级、离线）。PostGIS 只服务跨用户 feed。
- **隐私边界（必过）**：geo feed 对外只给**网格级**聚合 + 卡片（匿名）。半径查询
  在服务端算，结果**回传也粗化到 grid_cell**，**绝不**回精确坐标/owner 身份/精确地址。

### 端点

- `PATCH /api/tastes/:id/visibility` — body `{ targets: [{type,target_id?}] }`，
  服务端按目标算 geog + grid_cell（geo）、写 taste_shares、置 tastes.visibility='shared'。
- `GET /api/feed/geo?cell=<geohash>` — 某网格内的公开卡片（匿名）。
- `GET /api/feed/geo/near?lat=&lng=&radius=` — PostGIS 半径查询（结果坐标粗化到 cell）。
- `GET /api/feed/geo/heat?bbox=...` — 网格热度聚合（cell→count），驱动热力图。
- `GET /api/feed/family?member=<id>` — family / 指定成员可见的记录。
- 跨用户读**只**走这些 feed 端点；现有 `/api/tastes` 行为不变（只返回本人）。

### UI 面

- DetailView / AddModal：可见性选择器（私有 / 公开到附近 / 给家人 / 给某位家人）。
- You 页「新记录默认可见性」行**取消隐藏**（S2 起预留），绑 `default_visibility`。
- 新「附近」页：geohash 热力网格（hot/cold 视觉），点网格看该格匿名卡片流。

### 安全边界（细化时必须过 — 负向测试覆盖）

- share token 不可枚举、可撤销、可设过期；预览 presign ≤60s，撤销后不再 mint（S3a）。
- 绝不外发原 presigned URL；分享的是 token，照片导入时才复制、零分享期额外存储（S3a）。
- 非 'shared' 记录任何旁路不可读（geo/family/member feed 均不得泄漏 private 行）。
- geo feed 不泄漏精确坐标 / owner 身份 / 精确地址（半径查询结果也粗化到 grid_cell）。
- pro gating 全部服务端校验（taster CRUD、media、可见性发布），不信客户端。

---

## 验证要点（汇总）

- **S1**：截图版式多语言/长文案不溢出；Web 降级路径。
- **S2**：todo 无 verdict 不破坏现有列表/统计/搜索；转正流程数据完整。
- **S3a**：token 撤销/过期后 410；预览 presign 短期且撤销后不再签发；导入码降级路径可用；导入副本与源解耦（源改/删/撤销不影响已导入副本，因导入时已复制）；同 importer 重复导入幂等（UNIQUE）。
- **S3b**：taster 切换正确归属；free 用户无法建 taster（服务端拒）；迁移回填 self-taster 不丢历史 tastes。
- **S3b-media**：media_enabled=false 时不能传 video；封面帧提取 / 体积时长 cap。
- **S3c**：private 记录任何 feed 旁路不可读（负向）；geo feed 不暴露精确坐标/身份（半径结果粗化到 cell）；geohash 编解码单测（跨经线/赤道样例）；网格热度聚合正确；PostGIS `ST_DWithin` 半径查询正确性（含 GiST 索引命中）；`CREATE EXTENSION postgis` 在镜像/备份恢复链路可用；可见性发布服务端 pro 校验。
