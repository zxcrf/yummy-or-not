# Yummy or Not — repo conventions

## ⛔ main 分支保护

**`main` 分支禁止作为开发工作区。未经用户明确要求，禁止人为或 agent 在 `main` 上直接修改文件或执行会改写工作区/历史的操作**（包括但不限于直接编辑、生成或删除文件，commit、push、force-push、merge、rebase、cherry-pick、reset、stash apply、安装依赖，或运行会改写工作区的命令）。

允许在用户明确要求时，通过 `git pull --ff-only origin main` 这类 fast-forward pull，把远端已经合并到 `main` 的结果同步到本地 `main`；这不属于禁止的直接开发修改。如果 pull 需要产生 merge commit 或解决冲突，必须停止并告知用户。

根目录 checkout 可以切回 `main` 作为干净锚点。除用户明确要求的 fast-forward pull 外，任何 issue / PR / fix / feature / refactor / docs / test / review 工作，都必须先在仓库根目录的 `.worktrees/` 下创建独立 worktree 和独立分支，例如：

```bash
git worktree add -b fix/some-issue .worktrees/fix-some-issue origin/main
```

随后只允许在该 `.worktrees/<name>` 工作区内修改、测试、提交、推送和开 PR。`main` 工作区始终保留，不作为日常工作区使用。违反此规则视为高危操作，必须立即停止并告知用户。

## Unit tests are required for user-level feedback

Any fix that addresses **user-level feedback** (a bug report, crash, or
behavior complaint that a real user could hit) MUST ship with a complete unit
test that:

1. **Reproduces the reported failure** — the test must fail against the old
   (buggy) code and pass against the fix. Verify both directions before
   considering the work done.
2. **Pins the specific regression**, not just a happy path. Assert on the exact
   thing that broke (e.g. the component/element actually rendered, the value
   passed through, the error no longer thrown).
3. **Lives next to the code** under a `__tests__/` directory and runs in CI via
   the package's `test` script (`pnpm --filter <pkg> test`, wired through
   `turbo run test`).

If the affected package has no test setup yet, add it as part of the fix
(mobile uses `jest` + the `jest-expo` preset + `react-test-renderer`).

Example: the AddModal photo-preview crash on native
(`apps/mobile/components/app/__tests__/PhotoPreview.test.tsx`) — the preview
used a raw HTML `<img>`, so the test asserts a real React Native `<Image>`
renders and that no raw `img` element appears in the tree.

## 多端UI开发建议
**成功标准**
多端 UI 共享目标：业务页写一套，用户体验像各端原生，不为“100% 同一份 JSX”牺牲稳定性。

**推荐分层**
1. **共享业务页面**
   `AuthScreen`、`AddModal`、`LibraryView` 这类页面尽量不写 `Platform.OS`。只组合设计系统组件。

2. **共享组件 API**
   统一暴露 `Input`、`Button`、`Card`、`Tag`、`Modal`。调用方只关心 props，不关心底层是 Tamagui、RN primitive、DOM。

3. **平台分支放在组件内部**
   小差异：`Platform.OS === 'android'`。
   大差异：`Input.android.tsx`、`Input.ios.tsx`、`Input.web.tsx`。
   原则：分支越靠底层越好，别扩散到业务层。

4. **共享 token，不强共享实现**
   颜色、字号、间距、圆角统一。
   但 Android 原生关键样式用 resolved value，比如 `#191017`，不要把 Tamagui `$ink900` 直接丢给 native `TextInput`。

**TextInput 建议**
- Android 输入框：优先原生 `TextInput` plain style。
- 显式设置：`color`、`placeholderTextColor`、`selectionColor`、必要时 `cursorColor`。
- 设置：`includeFontPadding: false`、`textAlignVertical`，避免光标/文本偏移。
- Web/iOS：继续 Tamagui，保留 focus shadow、token、web 表现。
- 不建议：为追求统一，强行所有端都走 Tamagui styled input。

**什么时候该分平台**
- 输入框、Picker、Select、DatePicker、Modal、KeyboardAvoidingView。
- 文件上传、相机、相册、OAuth、分享。
- safe area、状态栏、键盘遮挡、滚动容器。
- 阴影/elevation、焦点态、hover、cursor。

**反模式**
- 业务页面到处写 `Platform.OS`。
- 复制两套完整页面：`AuthScreenAndroid` / `AuthScreenWeb`。
- token 直接传给原生关键属性。
- 用全局 native 配置修单个组件问题，比如全局改 Android cursor 色。
- 为一次问题抽象过度平台层。

**当前项目建议**
继续当前方向：`AuthScreen` 共享 `<Input />`，`Input` 内部 Android raw `TextInput`，Web/iOS Tamagui。若 `Input` Android 分支继续变长，再拆成 `Input.android.tsx`。测试保留 Android 回归：确认真实 RN `TextInput` 存在，且 `color` 是 concrete hex。

**UX 设计文档（按需阅读，不要预先全读）**
- 改键盘/输入框/表单/`KeyboardAvoidingView`/sticky footer → 先读 `docs/product/keyboard-ux.md`（键盘升降策略、动画同步准则、验收清单）。
- 加按压反馈/过渡/出入场动画 → 先读 `docs/product/material-motion.md`（动画 preset 与各组件已用模式）。
- 涉及 Web 与 Mobile 行为取舍 → 查 `docs/product/platform-differences.md`。

## 部署拓扑

| 层 | 地址 / 位置 | 说明 |
|---|---|---|
| API (Next.js) | `https://yon.baobao.click` | 自托管，baobao.click 服务器，Docker + Caddy TLS |
| 数据库 | `yon-pg` (PostgreSQL 17) | 自托管 Docker，`yon-net` 内部访问；宿主仅绑定 `127.0.0.1:5432` |
| 对象存储 | Cloudflare R2 (外部) | 用户照片 bucket 私有；读取走短期 presigned URL |
| 备份 | Cloudflare R2 `yon-db-backups` | 私有 bucket，独立 token；dump 上传前应客户端加密 |
| Docker 镜像 | `ghcr.io/zxcrf/yum-api:latest` | GHA (`docker-api.yml`) push main 自动构建 |
| Web SPA | `https://yon.baobao.click/web` | 嵌入 Next.js public/，同一容器服务 |

**更新 API 流程**：push main → GHA 构建推镜像 → 服务器 `docker pull ghcr.io/zxcrf/yum-api:latest && docker restart yum-api`。

**生产安全边界**：公网入口应只有 Caddy HTTPS 和 SSH。Postgres 不公网暴露；`DATABASE_URL`、`pg.env`、R2 tokens、`AMAP_KEY`（逆地理高德 Web 服务 key）均在服务器 `/etc/yum-api/*`，绝不进客户端包/代码仓库。`/etc/yum-api/.env` 为 `640 root:ubuntu`（目录 `750 root:ubuntu`），让部署用户 `ubuntu` 能读，从而 `docker run --env-file` 无需 sudo；`ubuntu` 本就有免密 sudo，故有效安全边界不变。SSH 是主要高风险入口，必须 key-only、禁用密码登录，并配合防火墙/fail2ban。逆地理细节见 `docs/ops/infra.md`。

**⚠️ EXPO_PUBLIC_API_URL 烧入构建**：`eas.json` 所有 profile 已指向 `https://yon.baobao.click`。
修改 API host → 必须重新构建 APK/AAB，否则旧包仍打旧地址。
OAuth callback URL 也注册在 `yon.baobao.click`，换域名需同步改 provider 配置。

## APK 构建策略（按用途，不要弄反）

**日常 / nightly / dev 构建走 GitHub Actions；只有正式 release 才用 EAS。**

- **GHA `.github/workflows/android-apk.yml` = 默认。** 触发条件是**推送 `v*` tag**（如
  `git tag v0.1.3 && git push origin v0.1.3`）**或手动 dispatch**（`gh workflow run android-apk.yml`）。
  **不再** push 到 main 时自动构建——这是为了在仓库设回 private 后省 CI 分钟（公开仓库无限免费，
  私有仓库吃 2000/3000 分钟/月额度，每次合并都出 14 分钟 APK 会很快耗尽）。日常想要某次 commit
  的包，直接手动 dispatch 即可。本地 Gradle 产出 `app-release.apk`，作为 workflow **artifact**
  上传（不是 EAS URL），retention 1 天。取包：`gh run download <run-id> -n app-release-<sha>`。
- **EAS cloud build 仅用于正式发版**（有限流、需 `eas-wynston` 交互登录）。**禁止**用 EAS 出
  dev/nightly 包。发 release 前，EAS 构建必须与 GHA 构建**完全对齐**：同一套构建 env、提前烧入
  内容（`EXPO_PUBLIC_API_URL` 等所有 baked 变量）、同一签名/keystore——EAS 产物须与 GHA 产物
  功能完全一致，任何偏离都算发版 bug。
