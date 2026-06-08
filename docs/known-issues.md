# Yummy or Not — 已知问题

从代码审查和用户故事推演中发现的 bug 和缺陷。

## Bug

### BUG-01 Recall 只返回首条匹配
- **位置**：`RecallView.tsx:128` — `items.find()` 仅匹配第一条
- **复现**：记录两条同名食物（如不同店的 "Ramen"），搜索只显示第一条
- **严重性**：Medium — 数据存在但用户看不到
- **修复**：改为 `items.filter()`，UI 渲染匹配列表

### BUG-02 Warn 开关不持久化
- **位置**：`DetailView.tsx:29` — `useState(true)` 纯前端状态
- **复现**：打开详情 → 关闭 warn 开关 → 离开 → 重新进入 → 开关回到开启
- **严重性**：Medium — 用户操作无效果
- **修复**：需后端字段支持 + API 读写

### BUG-03 Edit 按钮无功能
- **位置**：`DetailView.tsx:199` — Button 无 onPress handler
- **复现**：详情页点击 Edit，无任何响应
- **严重性**：Low（UI 误导） — 用户以为可以编辑但不能
- **修复**：接通编辑功能（见 Roadmap R01），或隐藏按钮直到功能就绪

### BUG-04 设置项不可交互
- **位置**：`YouView.tsx:23-49` — SettingRow 无 onPress
- **复现**：You 页点击 Warnings / Location / Private，无响应
- **严重性**：Low（UI 误导） — chevron 箭头暗示可点击
- **修复**：接通功能或移除 chevron 视觉提示

## 潜在问题

### RISK-01 Web 端删除确认体验差
- **位置**：`DetailView.tsx:67` — `Alert.alert()` 在 Web 降级为 `window.confirm`
- **影响**：Web 用户看到原生浏览器弹窗，风格与应用不一致
- **建议**：Web 端用自定义 Modal 组件替代

### RISK-02 YouView displayName fallback
- **位置**：`YouView.tsx:56` — `user?.displayName || 'Mina Park'`
- **影响**：未设置昵称的用户看到硬编码的 "Mina Park"
- **建议**：改为 i18n 化的默认文案，如 t('default_name') 或显示邮箱/手机号

### RISK-03 FoodCard tags 兼容性解析
- **位置**：`FoodCard.tsx:58-80` — `normalizeTags` 处理 JSON 字符串格式 tag
- **影响**：说明历史数据中 tags 存在格式不一致问题
- **建议**：做一次数据迁移修复脏数据，移除运行时兼容逻辑
