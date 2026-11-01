# 终端界面

[English](tui.md) | 中文

来自 [`dsh-tui`](../../packages/tui/tui/README.zh.md) 的终端界面。它是内置的 `tui` profile：`dsh-base` 组合 Agent 注册表、AgentLoop、Session 持久化、工具、沙箱、凭据、审批、提问与命令；`dsh-tui` bundle 增加一行前端。前端创建或恢复一个 Agent 并渲染其事件；它不拥有 Agent 逻辑、模型请求、工具或持久状态。

源文件：[`packages/tui/tui/src`](../../packages/tui/tui/src)

## 启动与生命周期

`dsh tui [--resume <id>] [--model <name>]` 通过普通启动器引导 profile。内层参数从 `ctx.cmdlineArgs` 读取；`--help` 在 Ink 挂载前打印界面自己的帮助并退出。stdin 不是 TTY 时会以可操作的诊断失败，而不是渲染非交互帧。

启动时运行时解析工作目录、等待 Loader 稳定，并解析默认模型路线。只有首条提示或 Agent 侧命令需要 Agent 时才以新的 `session-<uuid>` 调用 `ctx.agents.create()`，因此启动后未输入便退出不会留下已存储 Session。`--resume` 会立即对确切请求的 id 调用 `ctx.agents.resume()`。恢复的路线来自最后一条持久 `request/header`；`--model` 覆盖它。Agent 作用域的 `installModelSelection()` 监听器让后续 `/model` 改动在下一步生效，而不改写 Session 前缀。

最终的 `AgentHandle.dispose()` 释放 Agent。终端先刷新 Session，再通过卸载 Ink 恢复终端，最后请求 `ctx.appExit`。

## 快照

一个不可变快照驱动 React 树。每次渲染通过 `useSyncExternalStore` 读取它；运行时只在完整折叠后替换对象。

| 字段 | 内容 |
|---|---|
| `sessionId`、`cwd` | 当前 Session 身份与执行目录 |
| `provider`、`model` | 头部显示的活动路线 |
| `reasoningEffort` | 选中的推理等级；缺省表示 provider 默认 |
| `contextWindow`、`contextTokens` | 解析出的窗口与最近一次请求的提示加输出 token |
| `modelPicker` | 打开中的两步模型选择状态 |
| `status` | `starting`、`idle`、`running` 或 `stopped` |
| `transcript` | 用户提示、助手消息与终端通知 |
| `streaming` | 尚未提交的活动助手文本与推理 |
| `permission` | 队首待处理审批（若有） |
| `question` | 队首待处理提问批次（若有） |
| `tokens` | 累计输入、输出、缓存、推理与总计 |
| `turn` | 当前持久回合号 |

助手消息持有有序的文本、推理与工具块。工具结果按 `callId` 附加到对应块；没有已渲染调用的结果会被忽略，不会显示为孤立卡片。终端通知带有 `info` 或 `error` 种类。转录最多保留 `maxTranscriptMessages` 条；丢弃旧条目不触碰 Session 日志。

## 事件来源

运行时订阅六个 Cordis 事件，并让每个监听器按当前确切 Agent 过滤。组合了 jobs 服务时，它还会观察当前 Session 的 `ctx.jobs.events`。

| 事件 | 折叠 |
|---|---|
| `session/event` | `turn/start`、`turn/end`、`user/message`、`assistant/message`、`assistant/attempt`、`tool/call`、`tool/result`、`request/header`、`job/registered`、`job/settled` |
| `agent/assistant-stream` | 活动文本与推理增量；start、chunk、end 帧 |
| `agent/status` | 状态栏中的 `idle` 与 `running` |
| `agent/error` | 错误转录通知 |
| `approval/request` | 排队的审批面板 |
| `user-questions/request` | 排队的提问面板 |

持久的 `user/message` 按文本与乐观回显对账，因此提示在提交时立即出现，而无需等待持久化检查点。`assistant/message` 清除匹配的活动流并把其 usage 加入 token 总计。`turn/end` 关闭状态、清除待处理提示，并渲染失败或中断通知；已由 `agent/error` 渲染的失败不会重复。

## 流式输出

`agent/assistant-stream` 携带进程内的展示帧。运行时为每个回合与步骤保留一个活动帧，追加 `text-delta` 与 `reasoning-delta` 块，并最多每 `streamFrameMs` 发送一次。终端不向 stdout 写入原始块；由 Ink 渲染累计帧。已提交的 `assistant/message` 替换活动帧；被放弃的 attempt 会清除它。

活动的后台 job 会把输出流式写入其待处理工具卡片。`job/registered` 把 job id 映射到 `toolCall.callId`；`ctx.jobs.events` 上的每个 `output` 事件都会从该 job 的游标执行一次非消费式 `readAt`，合并后的文本追加到块中。`job/settled` 再排空一次并删除映射。保留的尾部受 `toolOutputChars` 限制，待处理卡片显示最新的 `toolOutputLines` 行，最终 `tool/result` 替换流式文本。

## 工具与 diff

工具卡片从已记录数据推导，从不依赖活动工具定义。卡片显示模型可见名称、紧凑参数摘要（`command`、`path`，未知工具用 JSON）、状态字形、前 `toolOutputLines` 行结果，以及错误结果的失败原因。若 `tool/result.meta.diffs` 携带通过校验的 `{ path, oldText, newText }` 条目，界面用有界行 diff 算法渲染带上下文的 hunk；超大文件退化为一个整体替换 hunk。

## 审批与提问

界面是已组合链条中的一个应答者。`y` 或 Enter 返回 `allowed-once`；`n` 或 Escape 返回 `rejected`。审批 seam 没有记忆授权，因此不提供“始终允许”。针对其他 Agent 的请求会委托给 `next()`。面板把请求的 call id 与运行时的 `tool/call` 参数关联，并调用匹配工具定义的 `presentCall`：文件改动渲染有界 diff 预览，终端调用渲染命令与工作目录。

提问面板显示批次中的一个活动问题、其可选详情、编号选项与自定义文本字段。数字键切换选项，可打印文本编辑自定义答案，Enter 提交，Left/Right 在问题间移动。提交会回答整个批次；带选项但既无选择也无自定义文本的问题会让面板保持打开。信号中止会拒绝等待中的请求。多个审批或提问请求重叠时各自排队；面板显示第一个，并在其结算后前进。

## 命令与会话

终端自有命令是 `/help`、`/model`、`/session`、`/sessions`、`/resume`、`/new`、`/clear`、`/context`、`/tools`、`/status` 与 `/exit`。`/model` 打开两步选择：先列出模型目录，再列出选中模型支持的推理等级，并带一个 `default` 行。Enter 确认高亮行，Esc 关闭；元数据未声明推理等级的模型会直接应用。选择会更新下一次请求的路线并保存部署默认值；保存失败时保留 Session 选择并报告失败。其他有效行会按需启动 Agent，然后交给 `ctx.commands.execute(agent, line, [], signal)`，从而保留 `/compact` 等 Agent 侧命令。无效或未知行产生通知，绝不会变成提示。

输入 `/` 会打开命令预测列表，列出终端自有命令与已注册 Agent 命令及其一句话解释。↑/↓ 移动选择，Tab 补全，Enter 执行确切命令或先补全唯一前缀，Esc 收起列表。列表打开时，↑/↓ 属于列表而不是历史。提交的行记录在 `$DSH_HOME/tui/history.json`，受 `historyLimit` 限制，并在界面启动时加载。

不带 id 的 `/resume` 会打开当前目录已记录 Session 的选择列表；列表显示已记录的最近标题以及 id 与时间，并排除当前 Session、子 Agent 与 fork 子会话，以及记录了 preset 的会话。键入内容按标题或 id 过滤，↑/↓ 移动，Enter 恢复，Esc 关闭。`/resume <id>` 直接恢复。打开失败会保留当前对话。`/new` 回到未启动的提示界面并释放当前 Agent，下一条提示才创建新 Session。两者在回合运行时拒绝执行。`/clear` 只丢弃已渲染条目。

## 布局

转录为空时，品牌 fish 标记与字标在对话视口内居中显示；首条条目出现后 banner 消失，`/clear` 后重新出现。标记是官方 logo 路径的终端字符描摹，并按终端宽度选择完整或紧凑版本。

头部显示产品名、路线与推理等级；状态栏显示缩短的工作目录、上下文使用量/窗口及百分比、推理等级与生命周期。未报告窗口的路线回退显示其上下文 token 数，`/context` 会重复完整统计。对话填充剩余行，底部对齐并用 `overflowY="hidden"` 裁剪；每个条目退出 flex 收缩，因此裁剪保留尾部。PageUp 与 PageDown 按整条记录移动保留窗口，鼠标滚轮通过仅在进程 TTY 上启用的 SGR 鼠标上报，每个滚轮刻度移动一条记录。提示面板或选择列表占用输入时，输入框保持草稿挂载但忽略按键。输入斜杠命令时，输入框最多增加六行预测；对话视口同步减少相同行数。

终端宽高来自活动 stdout，并跟随 resize 事件。报告零尺寸的 PTY 回退到 80×24。

## 失败行为

Ink 挂载后的启动失败会卸载终端、把诊断写入 stderr，并请求失败退出。无效启动器选项打印界面帮助并退出 1。回合结束或信号中止时，进行中的审批或提问会以 `cancelled` 或拒绝撤回。Session 刷新或 Agent 关闭失败会在终端恢复后报告到 stderr；它们不会静默声称干净关闭。

## 限制

界面只驱动一个 Agent，不连接常驻的 Web 或 Desktop Host。它不渲染图片、不接受附件、不处理鼠标点击或文本选择、不执行转录搜索，也不提供语法高亮或 diff 接受/拒绝操作。工具呈现读取原始记录数据，因此这里不使用工具的 Host 本地 presenter。
