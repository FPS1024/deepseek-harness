# iOS 移动端技术方案（局域网 Gateway + 本地通知）

状态：设计草案，未实现。

本文只回答“怎么做”：目标、架构、接口、工程结构、分阶段计划、风险。代码放在 `apps/ios`。

## 1. 目标与非目标

**目标**

- 个人使用，仅 iOS，不上架 App Store。
- 电脑上的 dsh/desktop 作为 gateway，iPhone 在同一局域网内使用。
- 手机上能查看会话、发消息、处理审批与提问。
- 本地通知（不依赖 APNs、不依赖推送服务器）：任务完成、待审批、待回答问题。
- 手机即 owner，不需要多用户/分享/权限分级。

**非目标**

- 公网访问、NAT 穿透、中继服务器（Relay）。
- Android、iPad、多设备管理。
- App Store 审核与合规。
- 在 App 被系统挂起时保证实时通知（iOS 没有这样的本地 API，见第 2 节）。

## 2. 先读：关键结论

1. **Gateway 不需要重新造。** `dsh --profile web` 已经提供 HTTP + WebSocket、登录令牌换签名 Cookie、Host/Origin 围栏、可选 TLS、反向代理支持。仓库里还有完整的 Typert Remote API、`$events` 事件流和 non-owner 权限模型。
2. **真正缺的是两块**：配对（把 gateway 地址和凭据安全地交给手机）和通知（Host 事件 → iOS 本地通知）。
3. **iOS 没有“局域网本地推送”API。** 后台通知只有三种现实选择：
   - 前台或短时后台：WebSocket 实时，最可靠；
   - `BGAppRefreshTask` 轮询：系统调度，延迟可能几分钟到几小时，不保证；
   - 后台音频常驻：个人侧载可用，接近实时，但耗电且不合 App Store 规则；
   - 真正可靠的后台实时通知只有 APNs（本方案明确不使用）。
4. **Web 客户端目前是桌面布局**，没有移动断点（`ui-layout` 只有 reduced-motion/transparency 的 media query）。手机能用的前提是补一套移动布局，或者先注入紧凑 CSS 验证可行性。
5. **推荐形态：SwiftUI 壳 + WKWebView 复用现有 Web UI。** 审批、工具卡片、历史、设置全部现成；原生只负责配对、通知、后台轮询、深链。全原生 Swift 客户端需要重写 RPC、mux、waterfall 和会话渲染，成本高一个数量级。

## 3. 总体架构

```text
iPhone (apps/ios)                                    电脑（gateway）
┌──────────────────────────────┐                     ┌────────────────────────────────────┐
│ SwiftUI App                  │      Wi-Fi LAN      │ dsh Host (web profile)             │
│  ├─ Pairing (QR + Keychain)  │ ◄─────────────────► │  ├─ host-webserver (bind LAN IP)   │
│  ├─ WKWebView (现有 Web UI)  │   HTTP + WebSocket  │  ├─ client-connection (token/cookie)│
│  ├─ MobileBridge (JS ↔ native)│                    │  ├─ Web client (同一套 UI)          │
│  ├─ NotificationService      │                     │  ├─ api-gateway / remote.mux        │
│  └─ BGAppRefresh → Pending   │                     │  └─ api-mobile (新增)               │
└──────────────────────────────┘                     └────────────────────────────────────┘
```

分工：

| 层 | 负责 | 不负责 |
|---|---|---|
| Gateway | 认证、HTTP/WS、会话与工具、事件流、移动通知聚合 | 手机 UI、通知展示 |
| WKWebView | 会话、发消息、审批、工具卡片、设置 | 后台运行、通知调度 |
| SwiftUI 壳 | 配对、Keychain、通知、后台刷新、深链、安全策略 | 业务状态与消息渲染 |
| 新增 Host 插件 | 把事件聚合成稳定的 `mobile/pending` 轮询接口 | 手机端展示逻辑 |

## 4. 现有能力（直接复用）

| 能力 | 位置 | 说明 |
|---|---|---|
| 浏览器远程访问 | `docs/user/guide/public-deployments.md` | `--host`、`--port`、`--tls-cert/--tls-key`、`--trusted-host`、`--public-url` |
| 登录令牌与 Cookie | `packages/client/connection/README.md` | `GET /?token=...` 换签名 Cookie；host-only、Path=/、HttpOnly、SameSite=Strict、TLS 时 Secure；默认 30 天 |
| Host/Origin 围栏 | 同上 | 只接受 loopback、listener bind IP、`trustedHosts`；拒绝跨站 |
| 类型化 API | `docs/api-gateway.md` | `POST /api/<namespace>/<method>`，`{ args }`；流走 `/api/remote.mux` |
| 会话接口 | `packages/api/session-controller/README.md` | `session/list`、`session/prompt`、`session/follow`、`session/control` 等 |
| 角色/权限 | `packages/api/remote-access/README.md` | 非 owner Peer 的 RBAC；手机 v1 是 owner，不需要 |
| 审批/提问事件 | `packages/api/remotes/src/remote-events.ts` | 转发 `approval/request`、`user-questions/request`、`api-session/status` 等 |
| 桌面壳 | `.agents/notes/implemented/architecture/2026-09-10-desktop-web-wrapper.md` | Electron 跑的就是同一套 Web composition |

两个需要注意的现状：

- 桌面 Host 在 [apps/desktop-host/src/index.ts:103](../../apps/desktop-host/src/index.ts#L103) 把交给壳的 URL 固定成 `127.0.0.1`。要让桌面 App 自己当 gateway，需要把监听地址和对外公布的 URL 做成可配置。
- 现在没有任何设备级凭据。Cookie 由持久化的 `client-connection/browser-session` 密钥签名，所有浏览器共用；要按设备吊销需要新增设备 token（v2）。

## 5. 需要新增的部分

### 5.1 Gateway 侧

**启动方式（v1，最快）**

```sh
dsh --profile web --host <局域网 IP> --port 3080 --no-open
```

- `--host` 必须是本机某张网卡的具体 IPv4/IPv6 地址，通配地址会被拒绝。
- 手机直接用这个 IP 访问时，Host/Origin 围栏接受 bind IP，不需要额外 `--trusted-host`；如果以后用 mDNS 名或反代，再加 `--trusted-host`。
- 要 TLS 就加 `--tls-cert`/`--tls-key`；自签名证书需要 iOS 信任（见第 10 节）。

**桌面 App 集成（v2）**

- 设置页加 “Remote access”：选择网卡、端口、可选 TLS、显示二维码。
- 需要改 desktop profile 的 webserver host 和 `authenticatedUrl` 的对外地址；当前只公布 loopback。
- 不做这一步也能用：直接用 bundled `dsh` 启动 web profile。但注意不要和桌面 App 同时跑两个 Host（同一份 `DSH_HOME` 下的会话写锁/配置可能互相干扰），二选一。

**新 Host 插件 `packages/api/mobile`（建议名 `@deepseek-ai/dsh-api-mobile`）**

职责：把“需要通知的事件”聚合成一个稳定、可轮询的接口，避免 iOS 端理解内部事件。

- 订阅 `api-session/status(sessionId, running)`：`true → false` 记一条 `turn-finished`。
- 监听 `approval/request`：记录 pending 审批（请求 id、session、工具、reason、时间），**必须 `next()` 委托**，不能抢答；请求 settle 后从 pending 集合移除。
- 监听 `user-questions/request`：同上。
- 维护单调递增的 `cursor` 和本次进程的 `hostId`。
- 暴露 `mobile/pending({ after })`：返回 `{ hostId, cursor, items }`。
- 只允许 owner 调用（v1）；将来要做受限设备时再走 `remote-access` policy。
- 用环形缓冲，限制条数/时长，避免长期运行时内存增长。

### 5.2 Web 客户端

**新 client 插件 `packages/client/mobile-bridge`**（只在 iOS/移动 profile 组合）

- `ctx.remote.$on('api-session/status', ...)` → 上报原生。
- `ctx.remote.$on('approval/request', (request, next) => { 上报; return next() })`，问题同理；桥只观察，不改变审批结果。
- 上报当前打开的 session，用于前台抑制重复通知。
- 暴露 `window.__DSH_IOS__.openSession(sessionId)`，供原生深链调用。
- 仅在 `window.webkit?.messageHandlers?.dshMobile` 存在时启用，桌面/浏览器加载时是空操作。

**移动布局**

- 优先改 `packages/client/ui-layout`（断点、侧栏抽屉、隐藏右栏、输入区安全区）。
- v1 可以先用 WKWebView 注入窄屏 CSS 验证；这只能算临时手段，长期应进客户端布局，否则维护成本高。
- 具体项见第 9 节。

### 5.3 iOS App

见第 8 节工程结构。

## 6. 关键流程

### 6.1 配对

1. Gateway 启动后输出 `http://192.168.1.23:3080/?token=<launch>`（桌面集成时显示为二维码）。
2. iPhone 扫码，校验 scheme、host、port、token 是否存在。
3. WKWebView 打开该 URL；Host 的 `GET /` 用 token 换签名 Cookie，302 到 `./`。
4. App 从 `WKWebsiteDataStore.httpCookieStore` 取出 Cookie，复制到 `HTTPCookieStorage.shared`（供后台 `URLSession` 使用），并把 gateway origin + Cookie 元数据存 Keychain。
5. 以后启动直接加载 `http://<gateway>/`；Cookie 默认 30 天内有效，Host 重启不需要重配。

注意：

- launch token 是进程级的，Host 重启后 token 变化，但已换到的 Cookie 仍然有效。
- 不要用 `GET /connect?token=...` 给 WKWebView 换 API Cookie：那条路径会创建一个绑定 WebSocket 的 API Peer，socket 关闭后同一个 Cookie 的后续 HTTP 会被拒绝。
- token 出现在二维码里，等同于密钥；只在自己手机和可信 Wi-Fi 下配对。

### 6.2 打开会话与发消息

- 会话列表、消息、工具卡片、文件上传、审批全部由现有 Web UI 完成，App 不重写。
- 通知点击 → `dsh-ios://session/<sessionId>`：
  - WebView 已加载：调用 `window.__DSH_IOS__.openSession(id)`。
  - 尚未加载：记下 pendingDeepLink，页面 ready 后再执行。
- 如果现有客户端没有“按 session id 导航”的公开入口，需要 mobile-bridge 里加一个很薄的适配；v1 也可以只打开 App，让用户自己点会话。

### 6.3 通知

**模式 A：前台实时（默认，最可靠）**

- mobile-bridge 把 `api-session/status`、`approval/request`、`user-questions/request` 上报原生。
- 前台用横幅或 `UNUserNotificationCenter` 本地通知。
- 当前正在看的 session 不重复通知。

**模式 B：后台轮询（默认后台方案）**

- `BGAppRefreshTask`（`earliestBeginDate ≈ +15 分钟`，系统自行决定实际时间）调用 `mobile/pending`。
- 与本地 `lastCursor` 比较，只对新增项发本地通知，然后更新 cursor。
- `hostId` 变化时清空 cursor，避免 Host 重启后漏通知。
- 适合“任务完成”这种可以晚几分钟的消息，不适合“审批马上要决策”。

**模式 C：后台常驻（可选，个人侧载）**

- `UIBackgroundModes: audio` + 静音音频，保持 WebSocket 存活，接近实时。
- 耗电明显，可能被系统在内存压力下杀掉；不合 App Store 规则，但个人侧载可行。
- 默认关闭，作为设置项，并明确提示代价。

**通知内容**

- 完成：`{session 标题} 已完成`（v1 把失败/取消也归为“本轮结束”）。
- 审批：`{session 标题} 需要审批：{tool}`，正文放 reason。
- 提问：`{session 标题} 有问题待回答`。
- 去重键：Host 生成的稳定 `itemId` + `cursor`；App 持久化 `lastCursor`。

**iOS 现实约束**

- App 被用户强制退出后，`BGAppRefreshTask` 不会运行。
- 系统可能很久不调度刷新；想“立刻知道”只能前台/常驻音频/APNs 三选一。
- 首次触发本地通知需要用户授权；前台展示还要实现 `UNUserNotificationCenterDelegate.willPresent`。

### 6.4 审批

- v1：通知只做提醒，点按回到 Web UI 操作。这样不需要在 Swift 里实现 `$events` 的 waterfall 回复。
- v2（可选）：通知上加“允许一次 / 拒绝”按钮。两种实现：
  - Swift 直接实现 `approval/request` 的 waterfall 回复（要接 `$events`/`$events/result` 协议）；
  - 或在 Host 加 `mobile/approve` unary 方法，由 Host 找到 pending 请求并作答（更简单，推荐）。
- v1 明确不做，避免把移动端变成第二个审批协议实现。

## 7. 接口契约

### 7.1 认证与配对（现有）

| 项 | 值 |
|---|---|
| 入口 | `GET /?token=<launch>`（只接受根路径） |
| 结果 | 302 到 `./`，写 host-only 签名 Cookie |
| Cookie | HttpOnly、SameSite=Strict、Path=/、TLS 时 Secure、默认 30 天 |
| 围栏 | loopback / listener bind IP / `trustedHosts`；Origin 必须同 authority |
| 断线 | Cookie 过期或密钥轮换后返回 401，需要重新配对 |

### 7.2 背景轮询（新增）

```http
POST /api/mobile/pending
Cookie: <浏览器 Cookie>
Content-Type: application/json

{ "after": 123 }
```

```json
{
  "hostId": "0d1f...",
  "cursor": 128,
  "items": [
    {
      "id": "turn-finished:session-1:42",
      "kind": "turn-finished",
      "sessionId": "session-1",
      "title": "Fix the Linux icon",
      "status": "completed",
      "at": "2026-10-22T12:00:00.000Z"
    },
    {
      "id": "approval:session-1:req-7",
      "kind": "approval",
      "sessionId": "session-1",
      "title": "Fix the Linux icon",
      "tool": "bash",
      "reason": "Run pnpm build",
      "at": "2026-10-22T12:01:00.000Z"
    }
  ]
}
```

约定：

- `after` 省略时从当前 cursor 开始（不返回历史），避免第一次安装时把所有历史都通知一遍。
- `approval`/`question` 只在仍 pending 时返回；解决后从后续响应消失。
- `hostId` 变化 → App 重置本地 cursor。
- 只返回 owner 可看的内容；v1 没有非 owner 场景。
- 失败语义：401 → 需要重新配对；网络失败 → 保留 cursor，下次重试；不要推进 cursor。

### 7.3 事件桥（Web → native）

```json
{ "v": 1, "kind": "session-status", "sessionId": "session-1", "running": false }
{ "v": 1, "kind": "approval", "requestId": "req-7", "sessionId": "session-1", "tool": "bash", "reason": "Run pnpm build" }
{ "v": 1, "kind": "question", "requestId": "q-3", "sessionId": "session-1" }
{ "v": 1, "kind": "active-session", "sessionId": "session-1" }
{ "v": 1, "kind": "ready" }
```

原生 → Web：`window.__DSH_IOS__.openSession(sessionId)`。

## 8. iOS 工程结构

```text
apps/ios/
  TECHNICAL-DESIGN.md
  project.yml                       # 可选：XcodeGen 生成工程
  DSHMobile/
    App/
      DSHMobileApp.swift           # 入口、场景、深链
      RootView.swift               # 配对 / 主界面切换
    Pairing/
      PairingView.swift            # 扫码、手动输入、错误提示
      QRScannerView.swift          # AVFoundation
      PairingService.swift         # URL 解析、校验、Cookie 交接
    Gateway/
      KeychainStore.swift          # gateway origin、Cookie 元数据
      PendingClient.swift          # mobile/pending（URLSession + Cookie）
      GatewayState.swift           # 可达性、登录失效、重新配对
    Web/
      WebViewContainer.swift       # WKWebView、CookieStore、进程池
      MobileBridge.swift           # WKScriptMessageHandler、注入脚本
      WebNavigation.swift          # 深链、返回、刷新
    Notifications/
      NotificationService.swift    # 授权、分类、本地通知
      NotificationRouter.swift     # 点击 → 深链
      NotificationStore.swift      # lastCursor / 已通知 id
    Background/
      BackgroundRefresh.swift      # BGTaskScheduler
    Settings/
      SettingsView.swift           # gateway、通知、重新配对、诊断
    Resources/
      Info.plist
      DSHMobile.entitlements
      Assets.xcassets
  DSHMobileTests/
    PairingURLTests.swift
    NotificationDedupeTests.swift
    PendingCursorTests.swift
```

Info.plist / entitlements 关键项：

| 键 | 值 | 原因 |
|---|---|---|
| `NSAppTransportSecurity.NSAllowsLocalNetworking` | `true` | 允许局域网 HTTP/WS；不放开公网 |
| `NSLocalNetworkUsageDescription` | 说明访问局域网里的电脑 | iOS 14+ 本地网络权限弹窗 |
| `UIBackgroundModes` | `fetch` | `BGAppRefreshTask` |
| `BGTaskSchedulerPermittedIdentifiers` | `com.<bundle>.refresh` | 后台刷新 |
| `CFBundleURLTypes` | `dsh-ios` | 通知点击/深链 |
| 可选 `UIBackgroundModes: audio` | 仅“常驻模式”开启 | 见 6.3 模式 C |

依赖：系统框架即可（SwiftUI、WebKit、UserNotifications、BackgroundTasks、AVFoundation、Security）。不需要第三方 SDK。

## 9. 移动 Web 适配

先做 Phase 0 评估，再决定改多少。当前几乎可以确定需要处理：

- 视口与安全区：`viewport-fit=cover`、`100dvh`、`env(safe-area-inset-*)`。
- 侧栏：56px rail 在手机上不可用，改成抽屉/底部入口。
- 右侧面板：默认关闭，按需全屏覆盖。
- 输入区：底部固定、键盘弹起时不遮挡、`font-size ≥ 16px` 防止 iOS 聚焦缩放。
- 触摸：hover-only 的操作要给点按路径；点击目标 ≥ 44pt。
- 长消息/工具卡片/代码块：横向滚动、折叠、避免撑破布局。
- 滚动：`overscroll-behavior`、避免双层滚动。
- 会话列表/标题栏：减少同时展示的列。

实现顺序：

1. WebView 注入窄屏 CSS，验证“能不能用”；
2. 把验证过的规则迁到 `ui-layout` / `ui-chat` / `ui-sidebar` 的断点；
3. 回归桌面 Web，确保断点只在窄屏生效。

## 10. 安全

- **HTTP 局域网**：token 和 Cookie 在 Wi-Fi 上明文传输，只适合完全可信的网络。能上 TLS 就上。
- **TLS 方案**：用 `mkcert` 给电脑的局域网 IP 签证书，iOS 安装并信任 mkcert CA（设置 → 通用 → 关于 → 证书信任设置），然后 `--tls-cert/--tls-key` 启动。WKWebView 会按系统信任链验证。
- **Keychain**：Cookie 用 `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`；可选 Face ID 解锁。
- **吊销**：删除 `$DSH_HOME/.credentials.yaml` 里的 `client-connection/browser-session` 记录并重启 Host，会让所有已签 Cookie 失效（不只是这台手机）。设备级吊销需要 v2 的设备 token。
- **绑定**：永远绑定具体网卡 IP，不绑 `0.0.0.0`；不需要时关掉 gateway。
- **二维码**：只包含一次性配对 URL，不长期展示；截图/转发等于泄露 token。
- **通知内容**：锁屏通知会显示会话标题和工具名；如果需要，设置里提供“隐藏详情”。

## 11. 构建与个人安装

- Xcode 16+，最低 iOS 17；SwiftUI + `@Observable`。
- 免费 Apple ID：个人团队签名 7 天有效，到期需重新用 Xcode 安装；最多 3 个 App。
- 付费开发者账号（99 美元/年）：签名 1 年，省去每周重签。
- 不上架：Xcode 直连设备安装即可；可选 AltStore/SideStore 做自动重签。
- 首次运行要允许“本地网络”，并信任开发者证书。
- 工程可以用 XcodeGen 维护 `project.yml`，减少 `.xcodeproj` 的合并噪音；也可以直接提交 `.xcodeproj`。

## 12. 分阶段计划与验收

### Phase 0：可行性验证（0.5–1 天，不改代码）

- 用 `dsh --profile web --host <LAN IP> --no-open` 启动 gateway。
- iPhone Safari 打开 token URL，登录、看会话、发消息、审批。
- 记录：哪些页面在竖屏不可用、通知需求是否只能靠前台、是否需要 TLS。
- 验收：手机能完成一次“发消息 → 等完成 → 看结果”。

### Phase 1：iOS 壳与配对（2–3 天）

- SwiftUI 工程、二维码扫描、Keychain、WKWebView 加载、Cookie 同步、设置页、重新配对。
- 后台 `URLSession` 能带 Cookie 调用一个受保护接口。
- 验收：冷启动直接进会话；Host 重启后不需要重新扫码；Cookie 失效时有明确提示。

### Phase 2：前台通知与事件桥（2–3 天）

- `packages/api/mobile`：`mobile/pending` + 事件聚合 + 单元测试。
- `packages/client/mobile-bridge`：状态/审批/提问上报、active session、openSession。
- 前台本地通知、权限请求、通知分类。
- 验收：手机前台时，任务完成和审批请求都能收到通知；审批仍能在 Web UI 正常完成。

### Phase 3：后台轮询与深链（2–4 天）

- `BGAppRefreshTask`、cursor 持久化、hostId 变化、去重、通知点击深链。
- 验收：App 进后台后 15–60 分钟内能收到完成/审批通知（受系统调度影响）；点击通知打开对应会话。

### Phase 4：移动布局与桌面集成（3–5 天，可拆分）

- 移动断点/抽屉/输入区/安全区；桌面 “Remote access” 设置与二维码；可选常驻音频、通知 action。
- 验收：竖屏下能完成主要操作，不需要横屏或缩放。

总计约 10–16 人日，最大不确定性是移动布局和 iOS 后台调度。

## 13. 风险与限制

| 风险 | 影响 | 应对 |
|---|---|---|
| iOS 后台挂起 | 后台通知延迟或丢失 | 接受 BGAppRefresh 的不确定性；或开启常驻音频；或未来上 APNs |
| 移动布局工作量大 | 手机体验差 | Phase 0 先评估；优先做抽屉 + 输入区 + 会话列表 |
| WKWebView 内存 | 长会话/大工具输出可能被杀 | 限制同时打开的会话；必要时原生列表 + WebView 详情 |
| Cookie 与 URLSession 不同步 | 后台轮询 401 | 配对后显式复制 Cookie；401 时回 WebView 重新加载 |
| 自签名 TLS | WKWebView 拒绝证书 | 安装并信任 CA；或在 App 内做证书 pinning |
| HTTP 明文 | 局域网内 token 泄露 | 只连可信 Wi-Fi；能上 TLS 就上 |
| 免费签名 7 天 | 每周重签 | 付费账号或 AltStore；文档记录流程 |
| 两个 Host 抢同一份数据 | 会话写锁/配置冲突 | 只用桌面 App 的 gateway 模式，或只用 CLI web profile |

## 14. 备选方案

| 方案 | 优点 | 代价 | 结论 |
|---|---|---|---|
| SwiftUI + WKWebView（本方案） | 复用全部 UI 与协议，最快可用 | 移动布局、WebView 限制 | 推荐 v1 |
| 全原生 Swift | 最佳体验、后台控制力强 | 重写 RPC/mux/waterfall/会话渲染，数月 | 不推荐作为起点 |
| React Native + 复用 TS 模型 | 可复用 transport/session model | UI 仍要重写，Cordis/RN 构建复杂 | 中期可选 |
| 纯 Safari PWA | 零安装 | iOS 无法后台本地通知，体验受限 | 只适合临时验证 |

## 15. 待确认

1. Gateway 用 HTTP 还是 TLS？（决定 iOS 证书方案和 ATS 配置）
2. 后台通知接受 BGAppRefresh 的延迟，还是要开启“常驻音频”换实时？
3. 先在 CLI `dsh --profile web` 上跑通，还是第一步就做桌面 App 的 “Remote access” 集成？
4. 通知里是否需要“直接批准/拒绝”（v2），还是点按回 Web UI 就够？
