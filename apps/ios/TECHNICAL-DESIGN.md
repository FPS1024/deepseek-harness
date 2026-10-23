# iOS 移动端技术方案（局域网 TLS Gateway + 本地通知）

状态：设计草案，未实现。

本文只回答“怎么做”：目标、架构、接口、工程结构、分阶段计划、风险。代码放在 `apps/ios`。

已确认的决策：

- 仅 iOS、个人使用、不上架 App Store。
- Gateway 只走局域网，**必须 TLS，不走明文 HTTP**。
- **不使用后台音频常驻**；后台通知只接受 `BGAppRefreshTask` 的不确定性。
- 先跑 CLI 的 `dsh --profile web`，桌面 App 内集成放到后面。
- 通知要覆盖：**待审批（可批准/拒绝）**、**工作完成**。

## 1. 目标与非目标

**目标**

- 电脑上的 dsh 作为 gateway，iPhone 在同一局域网内使用。
- 手机上能查看会话、发消息、处理审批与提问。
- 本地通知（不依赖 APNs、不依赖推送服务器）：
  - 工作完成；
  - 待审批，并支持在通知上直接“允许一次 / 拒绝”。
- 手机即 owner，不需要多用户/分享/权限分级。

**非目标**

- 公网访问、NAT 穿透、中继服务器（Relay）。
- Android、iPad、多设备管理。
- App Store 审核与合规。
- 后台音频常驻（已明确排除）。
- 在 App 被系统挂起时保证实时通知（iOS 没有这样的本地 API，见第 2 节）。

## 2. 先读：关键结论

1. **Gateway 不需要重新造。** `dsh --profile web` 已经提供 HTTP/HTTPS + WebSocket、登录令牌换签名 Cookie、Host/Origin 围栏、TLS 监听。加上 `--tls-cert/--tls-key` 即可满足“必须 TLS”。
2. **真正缺的是两块**：配对（把 gateway 地址和凭据安全地交给手机）和通知（Host 事件 → iOS 本地通知）。
3. **iOS 后台通知只有两条路**（在不用 APNs、不用后台音频的前提下）：
   - 前台或短时后台：WebSocket 实时，最可靠；
   - `BGAppRefreshTask` 轮询：系统调度，延迟可能几分钟到几小时，不保证；
   - 想更实时只能上 APNs 或后台音频，两者都已排除。
4. **审批的“批准/拒绝”需要 Host 配合。** 审批是 `approval/request` waterfall，正常由 Web UI 作答。通知上的操作要通过新增的 `mobile/approve` 回到 Host，并且不能破坏 Web UI 现有作答路径（第 5.1 节的 race 设计）。
5. **Web 客户端目前是桌面布局**，没有移动断点（`ui-layout` 只有 reduced-motion/transparency 的 media query）。手机能用的前提是补一套移动布局，或者先注入紧凑 CSS 验证。
6. **推荐形态：SwiftUI 壳 + WKWebView 复用现有 Web UI。** 审批、工具卡片、历史、设置全部现成；原生只负责配对、通知、后台轮询、深链、审批操作的回传。全原生 Swift 客户端需要重写 RPC、mux、waterfall 和会话渲染，成本高一个数量级。

## 3. 总体架构

```text
iPhone (apps/ios)                                    电脑（gateway）
┌──────────────────────────────┐                     ┌────────────────────────────────────┐
│ SwiftUI App                  │   HTTPS + WSS       │ dsh Host (web profile, TLS)        │
│  ├─ Pairing (QR + Keychain)  │ ◄─────────────────► │  ├─ host-webserver (bind LAN IP)   │
│  ├─ WKWebView (现有 Web UI)  │                     │  ├─ client-connection (token/cookie)│
│  ├─ MobileBridge (JS ↔ native)│                    │  ├─ Web client (同一套 UI)          │
│  ├─ NotificationService      │                     │  ├─ api-gateway / remote.mux        │
│  ├─ ApprovalActionHandler    │                     │  └─ api-mobile (新增)               │
│  └─ BGAppRefresh → Pending   │                     │     ├─ mobile/pending               │
└──────────────────────────────┘                     │     └─ mobile/approve               │
                                                     └────────────────────────────────────┘
```

分工：

| 层 | 负责 | 不负责 |
|---|---|---|
| Gateway | 认证、TLS、HTTP/WS、会话与工具、事件流、审批聚合 | 手机 UI、通知展示 |
| WKWebView | 会话、发消息、审批面板、工具卡片、设置 | 后台运行、通知调度 |
| SwiftUI 壳 | 配对、Keychain、通知、后台刷新、深链、审批操作回传 | 业务状态与消息渲染 |
| 新增 Host 插件 | 聚合通知事件、记录 pending 审批、提供 `mobile/pending` 与 `mobile/approve` | 手机端展示逻辑 |

## 4. 现有能力（直接复用）

| 能力 | 位置 | 说明 |
|---|---|---|
| Web GUI + TLS 监听 | `docs/user/guide/public-deployments.md` | `--host`、`--port`、`--tls-cert/--tls-key`、`--trusted-host` |
| 登录令牌与 Cookie | `packages/client/connection/README.md` | `GET /?token=...` 换签名 Cookie；host-only、Path=/、HttpOnly、SameSite=Strict；TLS 时 Secure；默认 30 天 |
| Host/Origin 围栏 | 同上 | 只接受 loopback、listener bind IP、`trustedHosts`；拒绝跨站 |
| 类型化 API | `docs/api-gateway.md` | `POST /api/<namespace>/<method>`，`{ args }`；流走 `/api/remote.mux` |
| 会话接口 | `packages/api/session-controller/README.md` | `session/list`、`session/prompt`、`session/follow`、`session/control` 等 |
| 审批/提问事件 | `packages/api/remotes/src/remote-events.ts` | 转发 `approval/request`、`user-questions/request`、`api-session/status` 等 |
| 桌面壳 | `.agents/notes/implemented/architecture/2026-09-10-desktop-web-wrapper.md` | Electron 跑的就是同一套 Web composition |

两个需要注意的现状：

- 桌面 Host 在 [apps/desktop-host/src/index.ts:103](../../apps/desktop-host/src/index.ts#L103) 把交给壳的 URL 固定成 `127.0.0.1`。桌面 App 自己要当 gateway 时，需要把监听地址和对外公布的 URL 做成可配置；本期先不做。
- 现在没有设备级凭据。Cookie 由持久化的 `client-connection/browser-session` 密钥签名，所有浏览器共用；要按设备吊销需要新增设备 token（后续版本）。

## 5. 需要新增的部分

### 5.1 Gateway 侧

#### 5.1.1 TLS 启动（本期使用 CLI）

必须给局域网 IP 签一张 iOS 信任的证书。推荐 `mkcert`：

```sh
# 电脑上
mkcert -install
mkcert 192.168.1.23          # 生成带 IP SAN 的证书
dsh --profile web \
  --host 192.168.1.23 \
  --port 3080 \
  --tls-cert ./192.168.1.23.pem \
  --tls-key  ./192.168.1.23-key.pem \
  --no-open
```

iOS 端信任 CA：

1. `mkcert -CAROOT` 找到 `rootCA.pem`；
2. AirDrop / 文件传到 iPhone，安装描述文件；
3. 设置 → 通用 → 关于本机 → 证书信任设置 → 对 mkcert CA 开启完全信任；
4. 用 Safari 打开 `https://192.168.1.23:3080/?token=...` 验证证书无警告。

要求与注意：

- `--host` 必须是本机某张网卡的具体 IPv4/IPv6 地址，通配地址会被拒绝。
- 证书 SAN 必须包含手机访问用的 IP；**给电脑配静态 IP 或 DHCP 保留**，否则 IP 一变证书和 Cookie 都失效。
- 手机用 bind IP 访问时，Host/Origin 围栏接受该 IP，不需要额外 `--trusted-host`；只有用主机名/反代时才需要。
- TLS 下 Cookie 是 `Secure`，WKWebView 与后台 `URLSession` 都必须走 HTTPS。
- 证书到期前重新签发；mkcert 默认有效期约两年，建议记入日历。
- 不要绑定 `0.0.0.0`；不用 gateway 时关掉进程。

#### 5.1.2 桌面 App 集成（后续，可选）

- 设置页加 “Remote access”：选择网卡、端口、TLS 证书、显示二维码。
- 需要改 desktop profile 的 webserver host 和 `authenticatedUrl` 的对外地址。
- 本期先不做；注意不要和桌面 App 同时跑两个 Host（同一份 `DSH_HOME` 下的会话写锁/配置可能互相干扰），二选一。

#### 5.1.3 新 Host 插件 `packages/api/mobile`（建议名 `@deepseek-ai/dsh-api-mobile`）

职责：聚合通知事件、记录 pending 审批、提供手机端操作入口。

**事件聚合**

- 订阅 `api-session/status(sessionId, running)`：`true → false` 记一条 `turn-finished`。
- 监听 `approval/request`：记录 pending 审批（请求 id、session、工具、reason、时间）。
- 监听 `user-questions/request`：记录 pending 提问。
- 维护单调递增的 `cursor` 和本次进程的 `hostId`。
- 环形缓冲，限制条数与时长。

**审批不抢答，但要能接受手机作答**

审批的 waterfall 必须继续交给 Web UI；同时允许 `mobile/approve` 抢先作答。做法是在 Host 侧注册一个位于转发链上游的监听器：

```text
ctx.on('approval/request', (request, next) => {
  const webAnswer = next()                 // 下游：转发给 Web UI，保持原行为
  const phoneAnswer = waitForPhone(request.id) // 由 mobile/approve 完成
  return Promise.race([webAnswer, phoneAnswer])
    .finally(() => forget(request.id))
})
```

- 两边谁先回答谁生效；另一方成为迟到答案，由审批服务丢弃。
- 监听器必须注册在转发链上游（先于把 waterfall 转发给 Client 的监听器），否则 Web UI 先作答时手机永远收不到请求。组合顺序需要写测试固定。
- 同一条审批只能被回答一次；`mobile/approve` 对已解决的请求返回 `mobile/stale`。

**接口**

- `mobile/pending({ after })`：返回 `{ hostId, cursor, items }`。
- `mobile/approve({ requestId, outcome })`：`outcome` 为 `allowed-once` 或 `rejected`；返回 `{ ok: true }` 或 `mobile/stale`。
- 只允许 owner 调用；`requestId` 不可猜测。
- 提问的“作答”不在本期范围，通知只提醒，点按回 Web UI。

### 5.2 Web 客户端

**新 client 插件 `packages/client/mobile-bridge`**（只在移动 profile 组合）

- `ctx.remote.$on('api-session/status', ...)` → 上报原生。
- `ctx.remote.$on('approval/request', (request, next) => { 上报; return next() })`，问题同理；桥只观察，不改变审批结果。
- 上报当前打开的 session，用于前台抑制重复通知。
- 暴露 `window.__DSH_IOS__.openSession(sessionId)`，供原生深链调用。
- 仅在 `window.webkit?.messageHandlers?.dshMobile` 存在时启用，桌面/浏览器加载时是空操作。

**移动布局**

- 优先改 `packages/client/ui-layout`（断点、侧栏抽屉、隐藏右栏、输入区安全区）。
- 本期可以先用 WKWebView 注入窄屏 CSS 验证；这只能算临时手段，长期应进客户端布局。
- 具体项见第 9 节。

### 5.3 iOS App

见第 8 节工程结构。

## 6. 关键流程

### 6.1 配对（全程 TLS）

1. Gateway 启动后输出 `https://192.168.1.23:3080/?token=<launch>`；终端里可以用 `qrencode -t ansiutf8 '<URL>'` 直接显示二维码（桌面集成后由 App 显示）。
2. iPhone 扫码，校验 scheme 必须是 `https`、host 是预期 IP、token 存在。
3. WKWebView 打开该 URL；Host 的 `GET /` 用 token 换签名 Cookie，302 到 `./`。
4. App 从 `WKWebsiteDataStore.httpCookieStore` 取出 Cookie，复制到 `HTTPCookieStorage.shared`（供后台 `URLSession` 使用），并把 gateway origin + Cookie 元数据存 Keychain。
5. 以后启动直接加载 `https://<gateway>/`；Cookie 默认 30 天内有效，Host 重启不需要重配。

注意：

- launch token 是进程级的，Host 重启后 token 变化，但已换到的 Cookie 仍然有效。
- 不要用 `GET /connect?token=...` 给 WKWebView 换 API Cookie：那条路径会创建一个绑定 WebSocket 的 API Peer，socket 关闭后同一个 Cookie 的后续 HTTP 会被拒绝。
- token 出现在二维码里，等同于密钥；只在自己手机和可信 Wi-Fi 下配对，不在公共网络展示。
- 换 IP 后 Cookie 的 host 变了，需要重新配对；这是静态 IP 的另一个理由。

### 6.2 打开会话与发消息

- 会话列表、消息、工具卡片、文件上传、审批全部由现有 Web UI 完成，App 不重写。
- 通知点击 → `dsh-ios://session/<sessionId>`：
  - WebView 已加载：调用 `window.__DSH_IOS__.openSession(id)`。
  - 尚未加载：记下 pendingDeepLink，页面 ready 后再执行。
- 如果现有客户端没有“按 session id 导航”的公开入口，需要 mobile-bridge 里加一个很薄的适配；v1 也可以只打开 App。

### 6.3 通知

**模式 A：前台实时（默认，最可靠）**

- mobile-bridge 把 `api-session/status`、`approval/request`、`user-questions/request` 上报原生。
- 前台用横幅或本地通知；当前正在看的 session 不重复通知。
- 前台时审批卡片就在 Web UI 里，通知只是补充。

**模式 B：后台轮询（唯一的后台方案）**

- `BGAppRefreshTask`（`earliestBeginDate ≈ +15 分钟`，系统自行决定实际时间）调用 `mobile/pending`。
- 与本地 `lastCursor` 比较，只对新增项发通知，然后更新 cursor。
- `hostId` 变化时清空 cursor，避免 Host 重启后漏通知。
- 不运行后台音频；App 被用户强制退出后不会刷新。
- 适合“工作完成”这种可以晚几分钟的消息；审批通知可能来晚，任务会一直等，这是本方案的硬限制。

**通知内容与分类**

- `turn-finished`：`{session 标题} 已完成`，动作 `打开`。
- `approval`：`{session 标题} 需要审批：{tool}`，正文放 reason；动作 `允许一次`、`拒绝`、`打开`。
  - `允许一次`、`拒绝` 设置 `authenticationRequired`，锁屏状态需先解锁，避免误操作。
  - `拒绝` 也可以改成“打开 App 再确认”；本期先直接拒绝，后续可调。
- `question`：`{session 标题} 有问题待回答`，动作 `打开`（不作答）。
- 去重键：Host 生成的稳定 `itemId` + `cursor`；App 持久化 `lastCursor`。
- 锁屏隐私：设置项“隐藏通知详情”，开启后只显示“DeepSeek Harness 有更新”。

**iOS 现实约束**

- `BGAppRefreshTask` 不保证按 15 分钟执行，可能几小时；没有音频/APNs 就没有更实时的后台方案。
- 首次触发本地通知需要用户授权；前台展示还要实现 `UNUserNotificationCenterDelegate.willPresent`。
- App 被系统回收后可能由后台任务重新拉起；被用户强制退出则不会。

### 6.4 审批：通知上的批准/拒绝

1. Host 的 `approval/request` 进入 `api-mobile` 监听器，记录 `requestId` 并 `next()`；Web UI 同时能显示审批卡片。
2. 手机收到 `approval` 通知。
3. 用户点“允许一次”或“拒绝”：
   - iOS 在 `didReceive` 中启动短时后台任务；
   - 调用 `mobile/approve({ requestId, outcome })`；
   - Host 用 `requestId` 唤醒 5.1.3 的 race，审批服务得到结果；
   - Web UI 的审批卡片随之消失/更新。
4. 失败处理：
   - `mobile/stale`：说明已在桌面/Web 作答，通知里显示“已在其他端处理”；
   - 网络失败/401：发一条本地通知“审批提交失败，点按打开”，并保留待办。
5. 会话完成后没有待审批项，后台轮询自然不会再返回它。

安全：

- `mobile/approve` 仍走 TLS + Cookie，Host/Origin 围栏不变；
- 通知动作需要设备解锁；
- 不把审批结果写进通知内容（避免泄露）。

## 7. 接口契约

### 7.1 认证与配对（现有）

| 项 | 值 |
|---|---|
| 入口 | `GET /?token=<launch>`（只接受根路径） |
| 结果 | 302 到 `./`，写 host-only 签名 Cookie |
| Cookie | HttpOnly、SameSite=Strict、Path=/、TLS 时 Secure、默认 30 天 |
| 围栏 | loopback / listener bind IP / `trustedHosts`；Origin 必须同 authority |
| 断线 | Cookie 过期或密钥轮换后返回 401，需要重新配对 |
| 传输 | 仅 HTTPS |

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
      "at": "2026-10-23T03:00:00.000Z"
    },
    {
      "id": "approval:session-1:req-7",
      "kind": "approval",
      "requestId": "req-7",
      "sessionId": "session-1",
      "title": "Fix the Linux icon",
      "tool": "bash",
      "reason": "Run pnpm build",
      "at": "2026-10-23T03:01:00.000Z"
    }
  ]
}
```

约定：

- `after` 省略时从当前 cursor 开始（不返回历史），避免第一次安装时把所有历史都通知一遍。
- `approval`/`question` 只在仍 pending 时返回；解决后从后续响应消失。
- `hostId` 变化 → App 重置本地 cursor。
- 只返回 owner 可看的内容。
- 失败语义：401 → 需要重新配对；网络失败 → 保留 cursor，下次重试；不要推进 cursor。

### 7.3 审批操作（新增）

```http
POST /api/mobile/approve
Cookie: <浏览器 Cookie>
Content-Type: application/json

{ "requestId": "req-7", "outcome": "allowed-once" }
```

- `outcome`: `allowed-once` | `rejected`
- 成功：`{ "ok": true }`
- 失败：`mobile/stale`（已作答/已取消）、`mobile/forbidden`（非 owner）、`gateway/...`（其他）
- 幂等：重复提交返回 `mobile/stale`，不重复改变审批结果。

### 7.4 事件桥（Web → native）

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
      PendingClient.swift          # mobile/pending、mobile/approve
      GatewayState.swift           # 可达性、登录失效、重新配对
    Web/
      WebViewContainer.swift       # WKWebView、CookieStore、进程池
      MobileBridge.swift           # WKScriptMessageHandler、注入脚本
      WebNavigation.swift          # 深链、返回、刷新
    Notifications/
      NotificationService.swift    # 授权、分类、本地通知
      NotificationRouter.swift     # 点击/动作 → 深链或审批
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
| `NSAppTransportSecurity.NSAllowsLocalNetworking` | `true` | 允许局域网地址连接；私有 CA 仍需在系统设置里信任 |
| `NSLocalNetworkUsageDescription` | 说明访问局域网里的电脑 | iOS 14+ 本地网络权限弹窗 |
| `UIBackgroundModes` | `fetch` | `BGAppRefreshTask` |
| `BGTaskSchedulerPermittedIdentifiers` | `com.<bundle>.refresh` | 后台刷新 |
| `CFBundleURLTypes` | `dsh-ios` | 通知点击/深链 |
| `UNNotificationCategory`（运行时注册） | `approval`、`turn-finished` | 批准/拒绝动作 |

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

- **TLS 是硬要求**：mkcert 私有 CA + iOS 安装信任；证书 SAN 覆盖电脑的静态 IP；不使用 HTTP。
- **静态 IP**：路由器上给电脑做 DHCP 保留，避免 IP 变化导致证书、Cookie、二维码全部失效。
- **Keychain**：Cookie 用 `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`；可选 Face ID 解锁。
- **本地网络权限**：iOS 首次访问会弹窗；拒绝后需要到设置里重新开启。
- **吊销**：删除 `$DSH_HOME/.credentials.yaml` 里的 `client-connection/browser-session` 记录并重启 Host，会让所有已签 Cookie 失效（不只是这台手机）。设备级吊销需要后续的设备 token。
- **绑定**：永远绑定具体网卡 IP，不绑 `0.0.0.0`；不需要时关掉 gateway。
- **二维码**：只包含一次性配对 URL，不长期展示；截图/转发等于泄露 token。
- **通知内容**：锁屏通知会显示会话标题和工具名；设置里提供“隐藏详情”。
- **审批动作**：`authenticationRequired`，锁屏需解锁；结果不回写到通知内容。

## 11. 构建与个人安装

- Xcode 16+，最低 iOS 17；SwiftUI + `@Observable`。
- 免费 Apple ID：个人团队签名 7 天有效，到期需重新用 Xcode 安装；最多 3 个 App。
- 付费开发者账号（99 美元/年）：签名 1 年，省去每周重签。
- 不上架：Xcode 直连设备安装即可；可选 AltStore/SideStore 做自动重签。
- 首次运行要允许“本地网络”，并信任 mkcert CA 和开发者证书。
- 工程可以用 XcodeGen 维护 `project.yml`，减少 `.xcodeproj` 的合并噪音；也可以直接提交 `.xcodeproj`。

## 12. 分阶段计划与验收

### Phase 0：TLS + 可行性验证（1 天，不改代码）

- mkcert 签 IP 证书、iOS 信任 CA。
- `dsh --profile web --host <LAN IP> --tls-cert ... --tls-key ... --no-open`。
- iPhone Safari 打开 token URL，登录、看会话、发消息、审批。
- 记录：哪些页面在竖屏不可用、审批/完成事件的实际延迟、是否有证书告警。
- 验收：手机能完成一次“发消息 → 等完成 → 看结果”；Safari 无证书错误。

### Phase 1：iOS 壳与配对（2–3 天）

- SwiftUI 工程、二维码扫描、Keychain、WKWebView 加载、Cookie 同步、设置页、重新配对。
- 后台 `URLSession` 能带 Cookie 调用一个受保护接口（先用 `session/list` 验证）。
- 验收：冷启动直接进会话；Host 重启后不需要重新扫码；Cookie 失效时有明确提示。

### Phase 2：前台通知 + 审批动作（3–4 天）

- `packages/api/mobile`：`mobile/pending`、`mobile/approve`、事件聚合、race 设计与单元测试。
- `packages/client/mobile-bridge`：状态/审批/提问上报、active session、openSession。
- 通知分类、权限、前台展示、批准/拒绝动作、`mobile/stale` 处理。
- 验收：
  - 前台时，完成和审批请求都能收到通知；
  - 在通知上“允许一次/拒绝”能真正改变审批结果；
  - 桌面 Web UI 的审批仍能正常作答，不会双答。

### Phase 3：后台轮询与深链（2–4 天）

- `BGAppRefreshTask`、cursor 持久化、hostId 变化、去重、通知点击深链。
- 验收：App 进后台后收到完成/审批通知（受系统调度影响，不保证时间）；点击通知打开对应会话。

### Phase 4：移动布局与桌面集成（3–5 天，可拆分）

- 移动断点/抽屉/输入区/安全区；桌面 “Remote access” 设置与二维码；可选通知详情隐藏。
- 验收：竖屏下能完成主要操作，不需要横屏或缩放。

总计约 11–17 人日，最大不确定性是移动布局和 iOS 后台调度。

## 13. 风险与限制

| 风险 | 影响 | 应对 |
|---|---|---|
| iOS 后台挂起 | 后台通知延迟或丢失 | 接受 BGAppRefresh 的不确定性；审批可能晚到，任务会等待；不使用音频/APNs |
| TLS 证书不被信任 | WKWebView 打不开 | 安装并信任 mkcert CA；SAN 覆盖 IP；静态 IP |
| 电脑 IP 变化 | 证书、Cookie、二维码失效 | DHCP 保留/静态 IP；换 IP 后重新配对 |
| 移动布局工作量大 | 手机体验差 | Phase 0 先评估；优先做抽屉 + 输入区 + 会话列表 |
| WKWebView 内存 | 长会话/大工具输出可能被杀 | 限制同时打开的会话；必要时原生列表 + WebView 详情 |
| Cookie 与 URLSession 不同步 | 后台轮询 401 | 配对后显式复制 Cookie；401 时回 WebView 重新加载 |
| 审批双答 | 两个端同时作答 | Host race 只接受第一个；`mobile/stale`；测试覆盖 |
| 免费签名 7 天 | 每周重签 | 付费账号或 AltStore；文档记录流程 |
| 两个 Host 抢同一份数据 | 会话写锁/配置冲突 | 只用 CLI web profile 或只用桌面 App gateway，二选一 |

## 14. 备选方案

| 方案 | 优点 | 代价 | 结论 |
|---|---|---|---|
| SwiftUI + WKWebView（本方案） | 复用全部 UI 与协议，最快可用 | 移动布局、WebView 限制 | 推荐 v1 |
| 全原生 Swift | 最佳体验、后台控制力强 | 重写 RPC/mux/waterfall/会话渲染，数月 | 不推荐作为起点 |
| React Native + 复用 TS 模型 | 可复用 transport/session model | UI 仍要重写，Cordis/RN 构建复杂 | 中期可选 |
| 纯 Safari PWA | 零安装 | iOS 无法后台本地通知，体验受限 | 只适合临时验证 |

## 15. 已确认与待确认

已确认：

- 仅 iOS、个人使用、不上架。
- 只走局域网，Gateway 必须 TLS。
- 不使用后台音频常驻；后台通知接受 BGAppRefresh 的延迟。
- 先跑 CLI web profile。
- 通知覆盖审批（可批准/拒绝）和工作完成。

待确认：

1. “拒绝”是否也允许直接在通知上完成，还是必须打开 App 再确认？（本期默认直接拒绝，锁屏需解锁）
2. 通知是否隐藏会话标题/工具名（锁屏隐私）？
3. 电脑的局域网 IP 能否在路由器上做 DHCP 保留（决定证书与 Cookie 的稳定性）？
