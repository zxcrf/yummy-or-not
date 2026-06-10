# Plan — 重复购买提醒 + 购买流水

> Roadmap 条目：P1「重复购买提醒」。
> 依赖：统一搜索函数（unified-search-and-tags.md）。
> 决议：**不做 push / 不做地理位置主动提醒**。

## 1. 持久层

### warn 开关（原 R03）

- `tastes` 加 `warn_before_buy boolean NOT NULL DEFAULT false`
- 创建时默认值：verdict = NAH → true；YUM / MEH → false
- `PATCH /api/tastes/{id}` 支持该字段；DetailView 现有 toggle（纯前端 state）接 API

### 全局开关

- `users` 加 `warnings_enabled boolean NOT NULL DEFAULT true`
- You 页 Warnings 行 = 此开关；关闭则下述三个提示场景全部静默

### 购买流水（替代原 R04 计数器递增）

`boughtCount` 单计数器丢信息（地点、价格可能每次不同——优惠券等）。升级：

```sql
CREATE TABLE taste_purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  taste_id uuid NOT NULL REFERENCES tastes(id) ON DELETE CASCADE,
  price numeric,            -- 可空；纯数字，沿用 currency-split 约定（符号由展示层按语言加）
  place text,               -- 可空；默认带出 taste.place
  created_at timestamptz NOT NULL DEFAULT now()
)
```

- `boughtCount` 改派生：`1 + count(taste_purchases)`，API 返回时计算，不再存储
- 迁移：存量 `bought_count > 1` 的记录，补 `bought_count - 1` 条流水
  （price/place 取 taste 自身值，created_at 取 taste 创建时间，标注近似）
- 副产品：Stats 未来可做真实消费曲线 / 复购榜

## 2. 三个触发场景

### A. Recall 多结果 + 警示（替代原 R02）

- `items.find()` → 统一搜索函数全量评分结果，分数过线全展示
- 布局：最高分一条保留现大色块 verdict 卡（视觉锚点），其余紧凑行
  列「其他匹配」——同名不同店各带自己的 verdict + place
- 命中 `warn_before_buy = true` 的记录：卡片升级警告样式
  （「上次标记过 ×_× NAH，别再买」文案，5 locale）

### B. Add 同名检测（打扰预算设计）

核心是控制打扰，四层边界：

1. **触发门槛**：debounce 500ms（停止输入才查）+ 最小长度
   （CJK ≥ 2 字，拉丁 ≥ 3 字符）。打字过程中永不弹。
2. **只对强信号提示**：统一搜索的「全等」「前缀/包含」匹配才提示，
   n-gram 弱匹配不提示。宁漏勿烦——漏了有 Recall 兜底。
3. **提示形态**：表单内一行可点横条（普通命中黄条 / warn 命中红条），
   绝不弹窗、绝不打断输入。点击展开匹配记录跳详情，点 X 关闭。
4. **关闭记忆**：本次表单会话内关闭后，同前缀不再重弹。

### C. +1 Again（Detail 页）

- Detail 页加「+1 Again」按钮 → 底部小 sheet：price / place 预填
  上次流水值（无流水则取 taste 自身），可改可直接确认 → POST 流水
- 最快路径两次点击；有优惠券改下价格即可
- 该 taste `warn_before_buy = true` 时，sheet 顶部显示警告条（不阻断）

## API 汇总

- `PATCH /api/tastes/{id}` — 支持 `warnBeforeBuy`
- `PATCH /api/user` — 支持 `warningsEnabled`（与头像/昵称编辑共用端点）
- `POST /api/tastes/{id}/purchases` — 新增流水 `{ price?, place? }`
- `GET /api/tastes/{id}` — 返回派生 boughtCount + 流水列表（Detail 页展示购买历史，可选）

## 验证要点

- warn 持久化：toggle → 刷新/重进仍保持（pin 原 R03 回归）
- Recall：多匹配全展示；warn 记录警告样式；单匹配布局不退化
- Add 检测：debounce 内不触发、弱匹配不提示、关闭后同前缀不重弹、
  warnings_enabled=false 时全静默
- 流水：+1 后 boughtCount 派生正确；迁移后存量计数不变
