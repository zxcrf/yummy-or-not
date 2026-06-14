# 密码重置 — Resend 邮件 + 移动端 UX（锁定设计）

Mobile-only。无 web 重置页：重置只能在 app 内完成。Token 走邮件到任意设备，
但**填写/提交永远在手机 app**。

## 后端（apps/api）

- `lib/email-templates.ts`（新）：`resetEmail({ token, link })` → `{ subject, text, html }`。
  双语 zh+en（API 无 locale 信号），纯函数，无依赖。含：deep-link 按钮、可复制
  token（monospace）、30 分钟有效、防钓鱼提示。
- `reset-request/route.ts` 的 `deliver()`：
  - `link = yummyornot://reset-password?token=<token>`（deep link，非 web）。
  - 传输选择，保持 fire-and-forget + timing-safe 不变：
    1. `RESEND_API_KEY` 有 → `POST https://api.resend.com/emails`（bearer，
       `{from: EMAIL_FROM, to, subject, text, html}`），非 2xx → `console.error`。
    2. 否则 `EMAIL_WEBHOOK_URL` → 现有 webhook。
    3. 否则 prod `console.error` / dev `console.log` token。
  - 缺 `RESEND_API_KEY` 不崩，回落旧行为。

## 共享（packages/shared）

- `reset-token.ts`（新）：`extractResetToken(input): string | null`。一处解析，
  两个入口（deep-link URL + 剪贴板字符串）共用：
  - `yummyornot://reset-password?token=X` → X
  - `https?://.../reset-password?token=X` → X
  - 裸 `^[0-9a-f]{64}$`（大小写） → 原样
  - 其他 → null

## 移动端（apps/mobile）

跨设备桥接（用户确认方案）：deep link 解析 + 剪贴板 [粘贴] 解析，共用
`extractResetToken`。无前台静默 sniff（避免 iOS 粘贴 toast / 隐私）——仅显式
触发：① deep link URL（`Linking.useURL`）② 用户点 [粘贴]。

`ForgotPasswordForm` 4 态（全在现有 auth 卡内，neo-brutalist 风格）：
1. **email**：邮箱输入 + 副标题 + 发送 + 顶部返回。
2. **sent（查收邮件）**：脱敏邮箱回显（枚举安全文案）、打开邮箱 App、
   「我已复制验证码 ›」、重新发送（倒计时，对齐后端 3/10min）、返回。
3. **reset（新密码）**：token 输入 + [从剪贴板粘贴]（或 deep-link 预填时显示
   「✓ 验证码已识别」隐藏 token 框）、新密码 + 显示/隐藏、至少 8 位提示、提交。
4. **done**：成功 + 去登录（回填邮箱）。

Deep-link 入口：捕获到 token → 直接跳 `reset` 态预填，跳过 email/sent。
signed-out 时 deep link 落在 AuthScreen（非 Stack 路由），故 token 喂进
AuthScreen state，不走 router。

i18n 新键加在 zh/en（与现有 reset 键一致；ja/ko/es 本就无 reset 键，
`translate()` 回落 en）。

## Token UX 决策

保留 256-bit hex token（不改后端格式）。deep-link autofill 消除手输；桌面看邮件
→ 复制链接/token → 手机 app 点粘贴解析。短码（6-8 位）方案需改后端 + 锁定，
本设计不采用。

## 测试

- shared：`extractResetToken`（4 类输入）。
- api：`email-templates`（token/link/expiry/防钓鱼存在）；`password-reset-routes`
  增 Resend 块（endpoint/header、token 在 text、慢 Resend 不阻塞、非 2xx →
  console.error、无 key 回落）。
- mobile：`AuthScreenReset` 增 deep-link 预填 + 粘贴解析 + 各态可达。

## 部署

新 env 进 `/etc/yum-api/*`（mode 600）：`RESEND_API_KEY`、`EMAIL_FROM`。
Resend 需 DNS 验证发信域名（baobao.click SPF/DKIM/DMARC TXT）。部署 = 改
env-file + **recreate** 容器（非 restart）。免费档 100/日、3000/月、1 域名。
