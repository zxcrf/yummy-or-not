# Plan — 全局统一搜索 + 用户 Tag 库

> Roadmap 条目：P0「全局统一搜索」「用户自定义 Tag 库」。
> 两者同期做：Library filter chips 依赖 Tag 库，搜索与 filter 在同一 UI 区域。

## 1. 统一搜索

### 现状

- `LibraryView.tsx` 前端 substring 过滤，仅 name + place，不含 notes
- `RecallView.tsx` 用 `items.find()` 只取第一条匹配
- Add 表单无同名检测

### 设计：内存评分，不上引擎

个人口味数据量级（几百~几千条）下，内存模糊匹配评分与 FTS5 效果无差别。
决议：**先做统一搜索函数，接口可替换**；FTS5（expo-sqlite）留给未来离线
支持（roadmap P4）一起做，届时 CJK 需 trigram tokenizer，单独评估。

### 共享搜索函数（packages/shared）

```ts
searchTastes(items: Taste[], query: string): ScoredResult[]
// ScoredResult = { item: Taste, score: number, matchedFields: Field[] }
```

匹配与计分（归一化：小写、去空格标点）：

| 匹配类型 | 说明 | 分值思路 |
|---|---|---|
| 全等 | name 完全相同 | 最高 |
| 前缀 / 包含 | query 是 name/place/notes 的子串 | 高，name > place > notes |
| n-gram 重叠 | CJK 2-gram、拉丁词级 token 交集 | 低，按重叠率 |

- 返回按 score 降序；调用方自己决定阈值（Recall/Library 展示弱匹配，
  Add 同名检测只取强+中，见 repurchase-warning plan）
- 纯函数，无 IO，放 `packages/shared`，三处调用：LibraryView、RecallView、AddModal

### 接入点

1. LibraryView：替换现有 substring 过滤，搜索范围补 notes，结果按分排序
2. RecallView：`find()` → 全量评分结果（详见 repurchase-warning plan 的展示设计）
3. AddModal 同名检测：复用同一函数，只消费强/中匹配

## 2. 用户 Tag 库

### 现状

- filter chips 硬编码 `FILTERS`（`packages/shared/src/types.ts:217`）
- `AddModal.tsx` `addCustomTag` 已支持自定义 tag，但只写入当条 taste，不沉淀

### 数据模型

```sql
CREATE TABLE user_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
)
```

- 新用户注册时 seed 一份默认 tag（沿用现 FILTERS 内容，去掉 "All"）
- tastes.tags 仍存字符串数组（不强外键），tag 库只管理「chips 候选集」；
  删 tag 不影响历史记录

### API

- `GET /api/tags` — 当前用户 tag 列表
- `POST /api/tags` — 新增（AddModal 自定义 tag 保存成功后自动写入）
- `DELETE /api/tags/{id}` — 删除
- `PATCH /api/tags/{id}` — 重命名（仅改候选集，不回写历史 taste）

### UI

1. LibraryView filter chips：`FILTERS` → `GET /api/tags`（SWR 缓存），"All" 前端固定
2. AddModal：chips 同源；`addCustomTag` 成功保存 taste 后把新 tag upsert 进库
3. You 页「Tag 管理」入口：列表 + 增删改（属 roadmap P2「You 页全区域可交互」）

### 迁移

存量用户：首次 `GET /api/tags` 为空时，服务端 lazy-seed 默认 tag +
该用户历史 tastes.tags 中出现过的自定义 tag（去重）。

## 验证要点

- 搜索函数单测：CJK / 拉丁 / 混合 query，各匹配层级的排序正确性；
  notes 命中能被搜到（老实现搜不到，pin 回归）
- Tag 库：默认 seed、自定义 tag 沉淀、删 tag 后历史记录 tags 不变、
  chips 与 AddModal 同源一致
