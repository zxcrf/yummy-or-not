# Yummy or Not — 核心用户故事

两个视角：Desktop Web（键盘鼠标浏览器）、Mobile App（手机触屏）。
每个故事包含用户动作、系统行为、预期结果。

---

## 视角 1：Desktop Web

访问地址：`https://yon.baobao.click/web`

### US-W01 首次访问（未登录）

| # | 用户动作 | 系统行为 | 预期结果 |
|---|---------|---------|---------|
| 1 | 浏览器打开 `yon.baobao.click/web` | AppGate 检测无 session | 显示 AuthScreen：心形 logo + "yummy or not" 品牌 + 标语 + 登录卡片 |
| 2 | 页面加载中 | splash 状态 | 居中心形图标，暖黄色背景 `#fff6e6`，加载完成自动切换到 AuthScreen |

### US-W02 邮箱注册（国际用户）

| # | 用户动作 | 系统行为 | 预期结果 |
|---|---------|---------|---------|
| 1 | 点击「Email」tab | 切换到邮箱表单 | 显示 Email + Password 输入框 + 「Login」按钮 |
| 2 | 点击「没有账号？去注册」 | 表单切注册模式 | 新增「Display Name」输入框，按钮变「Register」 |
| 3 | 填写昵称、邮箱、密码，点击「Register」 | POST `/api/auth/register` | 成功：自动登录进入 Library。失败：红色错误条（邮箱已注册 / 密码太弱 / 格式错误） |

### US-W03 手机号注册/登录（国内用户）

| # | 用户动作 | 系统行为 | 预期结果 |
|---|---------|---------|---------|
| 1 | 「Phone」tab 默认选中 | 显示手机号输入框 + 「发送验证码」 | 键盘类型 phone-pad |
| 2 | 输入手机号，点击「发送验证码」 | POST `/api/auth/otp/request` | 出现验证码输入框 + 「验证」+ 「重新发送」。开发环境显示 dev code |
| 3 | 输入 6 位验证码，点击「验证」 | POST `/api/auth/otp/verify` | 成功：进入主界面。失败：「验证码错误」 |

### US-W04 邮箱登录

| # | 用户动作 | 系统行为 | 预期结果 |
|---|---------|---------|---------|
| 1 | Email tab → 默认登录模式 | 显示 Email + Password + Login | — |
| 2 | 输入已注册邮箱和密码，点击「Login」 | POST `/api/auth/login` | 成功：进入主界面。密码错误：「凭证无效」 |

### US-W05 OAuth 社交登录

| # | 用户动作 | 系统行为 | 预期结果 |
|---|---------|---------|---------|
| 1 | Phone tab 下方：微信按钮（如已配置） | 分隔线 "OR" + domestic audience provider | 「继续使用 微信」 |
| 2 | Email tab 下方：Google / Apple 按钮 | international audience provider | 「Continue with Google」 |
| 3 | 点击 OAuth 按钮 | `location.assign(oauthStartUrl)` 跳转 | 浏览器导航到 provider 授权页，完成后回调回应用 |
| 4 | 未配置 provider 时点击 | 按钮灰色 opacity 0.6 | 红色错误条：「该登录方式暂不可用」 |

### US-W06 语言切换（登录前）

| # | 用户动作 | 系统行为 | 预期结果 |
|---|---------|---------|---------|
| 1 | 点击 AuthScreen 右上角语言切换器 | 弹出下拉菜单（Portal 实现，z-index 最高） | 5 种语言：中文、English、日本語、한국어、Español |
| 2 | 选择目标语言 | i18n provider 切换 locale | 所有文案即时切换 |

### US-W07 主界面导航

| # | 用户动作 | 系统行为 | 预期结果 |
|---|---------|---------|---------|
| 1 | 登录成功 | AppGate 检测到 session | 进入 Tab 导航，默认 Library 页 |
| 2 | 窗口宽度 ≥ 768px | `gtMd` media query | 左侧 sidebar：Library / Recall / Log a taste / Stats / You |
| 3 | 窗口宽度 < 768px | 窄屏布局 | 底部 tab bar + 中间 FAB |
| 4 | 点击导航项 | expo-router 切换 tab | 页面切换，当前 tab 高亮 |

### US-W08 Library — 浏览味道列表

| # | 用户动作 | 系统行为 | 预期结果 |
|---|---------|---------|---------|
| 1 | 进入 Library | GET `/api/tastes` | 标题「Your Tastes」+ 「X logged」计数。加载中 ActivityIndicator |
| 2 | 列表加载完成 | 渲染 FoodCard 网格 | 桌面 2 列（48% 宽）。每卡：照片(4:3) + verdict 印章 + 名称 + 价格 + 地点 + 标签 + 购买次数 |
| 3 | 搜索框输入关键词 | 前端按 name/place 即时过滤 | 仅匹配条目可见 |
| 4 | 点击 filter chip | 按 tag/名称过滤 | 可选：All, Boba, Coffee, Ramen, Dessert, Burger, Pizza, Spicy。选中高亮 |
| 5 | 搜索 + filter 同时 | 两条件取交集 | 如：搜 "sugar" + filter "Boba" → 交集结果 |
| 6 | 无结果 | shown.length === 0 | 空状态：收据图标 + 「Nothing here」 |
| 7 | 点击 FoodCard | `router.push('/taste/{id}')` | 跳转详情页 |

### US-W09 Add — 记录新味道

| # | 用户动作 | 系统行为 | 预期结果 |
|---|---------|---------|---------|
| 1 | 点击 FAB / sidebar「Log a taste」 | 路由 `/add` | 全屏表单：标题 + X 关闭 |
| 2 | 点击照片区域 | 触发隐藏 `<input type="file" accept="image/*">` | 系统文件选择器打开 |
| 3 | 选择图片 | `URL.createObjectURL` 生成预览 | 照片区显示预览 |
| 4 | 输入「What?」 | 文本（必填） | 如 "Brown sugar boba" |
| 5 | 输入「Where?」 | 文本（可选） | 如 "Tiger Sugar · Hongdae" |
| 6 | 输入「Price」 | 文本（可选） | 如 "$5.80" |
| 7 | 选择 Verdict | 三大按钮：◕‿◕ YUM / •_• MEH / ×_× NAH | 选中变色 + 阴影弹出。必须选一个才能保存 |
| 8 | 选择 Tags | 点击 chip 切换 | 可选：Boba, Coffee, Ramen, Dessert, Burger, Pizza, Spicy, Sweet, Savory。可多选 |
| 9 | 输入备注 | 多行 Textarea | 可选 |
| 10 | 点击「Save」 | POST `/api/tastes` multipart/JSON | 成功：跳转新条目详情页。Save 按钮在 name 空或未选 verdict 时禁用 |
| 11 | 保存失败 | 显示红色错误 | 按钮恢复可点 |
| 12 | 点击 Cancel / X | 路由 back | 数据丢弃 |

### US-W10 Detail — 味道详情

| # | 用户动作 | 系统行为 | 预期结果 |
|---|---------|---------|---------|
| 1 | 从 Library/Recall 点击 | GET `/api/tastes/{id}` | 顶部大图 240px + 左下 verdict 印章（倾斜 -5°） |
| 2 | 查看内容 | 渲染完整信息 | 名称 + 地点 + 价格 + Badge 行（购买次数 + tags + 日期） |
| 3 | 有备注 | note 卡片 | 标题「Your Note」+ 全文 |
| 4 | Warn 开关 | 本地 toggle，默认开 | Switch 切换状态 |
| 5 | 点击「Delete」 | Alert 确认弹窗 | 确认 → DELETE `/api/tastes/{id}` → 返回上页。取消 → 关闭弹窗 |
| 6 | 返回箭头 | `router.back()` | 返回来源页 |
| 7 | 记录不存在 | 404 | info 图标 + 「Nothing here」+ 返回按钮 |

### US-W11 Recall — 「吃过吗？」快速查找

| # | 用户动作 | 系统行为 | 预期结果 |
|---|---------|---------|---------|
| 1 | 进入 Recall | 加载全部 tastes | 标题「Tasted it before?」+ 大搜索框。空搜索：显示最近 4 条 |
| 2 | 搜索 → 命中 | `items.find()` 匹配 name | 大色块 verdict 卡片（绿/橙/红）+ 大字结论 + 匹配记录行 |
| 3 | 搜索 → 未命中 | 无匹配 | 「No record for "xxx"」+ 「Try it, then log it!」+ 「Log it now」按钮 |
| 4 | 点击「Log it now」 | `router.push('/add')` | 跳转 Add |
| 5 | 点击结果行 | `router.push('/taste/{id}')` | 跳转详情 |

### US-W12 Stats — 统计仪表盘

| # | 用户动作 | 系统行为 | 预期结果 |
|---|---------|---------|---------|
| 1 | 进入 Stats | GET `/api/stats` | 标题「Stats」 |
| 2 | verdict 磁贴 | 3 个大磁贴横排 | YUM(绿) / MEH(橙) / NAH(红)，白字大数字 |
| 3 | 省钱卡片 | nah 价格总和 | 币图标 + 「Saved $X.XX」 |
| 4 | verdict 分布条 | 水平条形图 | 3 条进度条 + 右侧数量 |

### US-W13 You — 个人中心

| # | 用户动作 | 系统行为 | 预期结果 |
|---|---------|---------|---------|
| 1 | 进入 You | 读取 user + items | 头像 + 昵称 + Pro badge（如有）+ 「X tastes logged」 |
| 2 | 语言切换 | LangSwitcher 下拉 | 5 语言即时切换 |
| 3 | verdict 统计 | 3 小磁贴 | 同 Stats 但更紧凑 |
| 4 | 省钱卡 | 同 Stats | 币图标 + 金额 |
| 5 | 设置列表 | 3 行设置项 | Warnings / Location / Private，右侧 chevron |
| 6 | 「Sign Out」 | 清除 session | 返回 AuthScreen |

---

## 视角 2：Mobile App

通过 EAS APK 安装或 Expo Go 开发预览。

### US-M01 启动（未登录）

| # | 用户动作 | 系统行为 | 预期结果 |
|---|---------|---------|---------|
| 1 | 点击 app 图标 | 加载 Expo bundle，AppGate 检查 session | Splash：居中心形图标，暖黄色背景 |
| 2 | 无有效 session | 显示 AuthScreen | 与 Web 相同登录界面，原生容器渲染。KeyboardAvoidingView 防键盘遮挡 |

### US-M02 手机号登录

| # | 用户动作 | 系统行为 | 预期结果 |
|---|---------|---------|---------|
| 1 | 默认「Phone」tab | 手机号输入框 | 弹出数字键盘 (`phone-pad`) |
| 2 | 输入手机号，点击发送 | POST `/api/auth/otp/request` | 验证码输入框出现（`number-pad`），autoComplete `sms-otp` |
| 3 | 输入验证码，点击验证 | POST `/api/auth/otp/verify` | 成功进入主界面 |
| 4 | 点击重新发送 | 重新调用 requestOtp | 重发验证码 |

### US-M03 邮箱登录/注册

| # | 用户动作 | 系统行为 | 预期结果 |
|---|---------|---------|---------|
| 1 | 点击「Email」tab | 切换表单 | 邮箱键盘；Android 密码框用原生 TextInput（`secureTextEntry`，`color: #191017`） |
| 2 | 注册/登录流程 | 与 Web 一致 | Android 密码框保证文字可见和光标正确 |

### US-M04 OAuth 社交登录

| # | 用户动作 | 系统行为 | 预期结果 |
|---|---------|---------|---------|
| 1 | 点击 OAuth 按钮 | `expo-web-browser` 打开 in-app 浏览器 | 应用内弹出 provider 授权页 |
| 2 | 完成授权 | 回调 URL 回到 app | in-app 浏览器关闭，自动登录 |

### US-M05 主界面导航

| # | 用户动作 | 系统行为 | 预期结果 |
|---|---------|---------|---------|
| 1 | 登录成功 | 进入 Tab 导航 | 底部 tab bar：Library / Recall / ➕(FAB) / Stats / You |
| 2 | 点击 tab | Expo Router 切换 | 页面切换，tab 高亮 |
| 3 | 点击 ➕ FAB | 路由 `/add` | 全屏 Add 表单 |

### US-M06 Library（手机）

| # | 用户动作 | 系统行为 | 预期结果 |
|---|---------|---------|---------|
| 1 | 进入 Library | 加载列表 | 标题 + 计数。单列布局 |
| 2 | **下拉刷新** | RefreshControl | 刷新指示器 + 重新拉取。**Web 无此交互** |
| 3 | 搜索 / filter | 弹出系统键盘，即时过滤 | 与 Web 一致 |
| 4 | 点击 FoodCard | 导航详情 | 原生 stack push 动画（右滑入） |
| 5 | 上下滑动 | ScrollView 原生滚动 | 惯性 + 弹性边界 |

### US-M07 Add — 记录新味道（手机核心操作）

| # | 用户动作 | 系统行为 | 预期结果 |
|---|---------|---------|---------|
| 1 | 点击 ➕ FAB | 进入 Add | KeyboardAvoidingView 包裹全屏表单 |
| 2 | 点击照片区域 | `launchImageLibraryAsync` | 请求相册权限 → 系统相册（可裁剪，质量 0.8） |
| 3 | 选择照片 | `compressAsset`：max 1600px，JPEG 0.7 | 压缩后预览。失败回退原图 |
| 4 | 点击「📷 拍照」按钮 | `launchCameraAsync` | 请求相机权限 → 系统相机。**仅 native 可见** |
| 5 | 权限被拒 | 设置错误提示 | 显示错误 |
| 6 | 输入各字段 | 系统键盘弹出 | `keyboardShouldPersistTaps="handled"`。Android 文字 `#191017` 保证可见 |
| 7 | 选 Verdict / Tags / 备注 | 同 Web | — |
| 8 | Save | multipart POST | 成功跳详情。失败显示错误 |

### US-M08 Detail（手机）

| # | 用户动作 | 系统行为 | 预期结果 |
|---|---------|---------|---------|
| 1 | 从 Library 点击 | Stack push 进入 | 大图 + verdict 印章 + 返回箭头 |
| 2 | 滑动查看 | ScrollView | 完整信息 + 操作按钮 |
| 3 | Delete | **原生 `Alert.alert` 系统弹窗** | 系统原生确认弹窗（非 Web 风格） |
| 4 | 确认删除 | DELETE API | 自动返回 |
| 5 | 返回 | 箭头 / **Android 系统返回手势** | 原生返回动画 |

### US-M09 Recall（手机）

| # | 用户动作 | 系统行为 | 预期结果 |
|---|---------|---------|---------|
| 1 | 进入 Recall | 加载数据 | 大搜索框（字号 18，大 padding 适合触屏） |
| 2 | **下拉刷新** | RefreshControl | 刷新。Web 无此操作 |
| 3 | 搜索结果 | 同 Web | verdict 卡片 / 无结果提示 |

### US-M10 Stats（手机）

| # | 用户动作 | 系统行为 | 预期结果 |
|---|---------|---------|---------|
| 1 | 进入 Stats | GET `/api/stats` + fallback 本地计数 | 与 Web 一致布局 |
| 2 | **下拉刷新** | RefreshControl | 重新拉取 stats + items |

### US-M11 You（手机）

| # | 用户动作 | 系统行为 | 预期结果 |
|---|---------|---------|---------|
| 1 | 查看个人信息 | user + items | 头像 + 昵称 + 统计 |
| 2 | 语言切换 | LangSwitcher | 5 语言即时切换 |
| 3 | Sign Out | 清除 session | 返回 AuthScreen |
