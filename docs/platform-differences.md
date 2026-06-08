# Yummy or Not — 平台差异对比

Desktop Web vs Mobile App 行为差异。

| 维度 | Desktop Web | Mobile App |
|------|-------------|------------|
| **导航布局** | 宽屏(≥768px)：左侧 sidebar；窄屏：底部 tab bar | 始终底部 tab bar + 中间突出 FAB |
| **照片上传** | `<input type="file">` 文件选择器，单入口 | expo-image-picker：相册选择 + 拍照按钮（两个入口） |
| **照片压缩** | expo-image-manipulator（同一套逻辑） | 同左，max 1600px / JPEG 0.7 |
| **下拉刷新** | 无（首次加载 + 路由切换刷新） | 原生 RefreshControl（Library / Recall / Stats） |
| **删除确认** | `Alert.alert` → 降级 `window.confirm` | 原生系统弹窗 |
| **OAuth 跳转** | `location.assign()` 全页跳转 | `expo-web-browser` in-app 浏览器 |
| **键盘处理** | 浏览器原生 | KeyboardAvoidingView（iOS: padding, Android: height） |
| **输入框实现** | Tamagui styled Input | Android: 原生 RN TextInput（color `#191017`）；iOS/Web: Tamagui |
| **密码输入** | `type="password"` HTML 属性 | `secureTextEntry` RN 属性 |
| **页面切换动画** | 即时切换，无动画 | Stack push/pop 原生过渡动画 |
| **系统返回** | 浏览器后退按钮 | Android 系统返回手势 / 按钮 |
| **列表布局** | 桌面 2 列网格（48% 宽） | 单列全宽 |
| **Recall 搜索框** | 标准尺寸 | 大尺寸（fontSize 18, padding 16），适合触屏 |
| **拍照入口** | 无，仅文件选择 | 照片区域下方独立「拍照」按钮 |
