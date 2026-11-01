---
description: "dsh 终端界面：覆盖核心 Agent 注册表、Session 日志、命令注册表、审批 seam 与用户提问 seam 的 React + Ink 前端。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-tui

[English](README.md) | 中文

## 概述

`dsh-tui` 是以 `tui` profile 交付的交互式终端界面。它通过 `ctx.agents` 创建或恢复一个 Agent，把 `session/event` 与 `agent/assistant-stream` 折叠成不可变渲染快照，并用 React + Ink 绘制。输入框内容会变成普通的 Agent 后续消息或斜杠命令；审批与用户提问请求会暂停输入框，直到用户作出决定。Agent 执行、持久化、工具与策略仍留在已组合的核心包中，因此该界面从不导入 AgentLoop，也不自行发起模型请求。

## 目录

- [使用本包](#use-this-package)
- [配置](#configuration)
- [概念](#concepts)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包

在交互式终端启动内置 profile：

```sh
dsh tui
dsh tui --resume session-abc
dsh tui --model deepseek-reasoner
dsh tui --model deepseek-official/deepseek-chat
dsh tui --help
```

`--resume`（`-r`）接管一个确切的已存储 Session；除非 `--model` 覆盖，其最近一次请求头记录的路线会成为活动模型。没有 `--resume` 时界面不会预先创建 Session；首条提示或 Agent 侧命令才创建 `session-<uuid>`，启动后未输入便退出不会保存任何内容。stdin 不是 TTY、选项未知或标志缺少值都会在 Ink 挂载前失败。

该 bundle 声明 `dsh.bundle.patch`；内置的 `tui` 模板叠加 [`dsh-base`](../../bundle/base/README.zh.md) 与本 bundle。base 提供 AgentLoop、Session 持久化、工具、沙箱、凭据、审批服务与命令注册表。补丁设置共享编码人格、保留临时的 `DSH_TOOLS_MODE` 进程级开关、插入 `tui` 行并禁用 HMR。

### 按键

| 按键 | 行为 |
|---|---|
| Enter | 发送输入框文本 |
| Shift+Enter | 插入换行 |
| Ctrl+C | 取消活动回合（保留排队输入） |
| Ctrl+D | 退出终端 |
| PageUp / PageDown | 按三条记录滚动转录 |
| 鼠标滚轮 | 在对话视口内上下滚动（多数终端中按住 Shift 可选择文本） |
| Ctrl+T | 展开或折叠推理块 |
| Tab | 补全选中的斜杠命令 |
| ↑ / ↓ | 先移动命令预测，再回溯输入框历史 |
| ← / → | 移动输入框光标 |

### 命令

终端自己处理 `/help`、`/model`、`/session`、`/sessions`、`/resume`、`/new`、`/clear`、`/context`、`/tools`、`/status` 与 `/exit`。`/model` 打开两步选择：先选模型，再选推理等级（`default` 加上适配器声明的 Off/Low/High/Max 等）。`/model <model>` 或 `/model <provider>/<model>` 仍可直接切换，并清除推理等级覆盖。输入 `/` 会打开实时预测列表，并显示每条命令的一句话解释；↑/↓ 选择，Tab 补全，Enter 执行确切命令或先补全唯一前缀，Esc 收起列表。不带 id 的 `/resume` 会打开当前目录下已存储 Session 的选择列表，显示已记录的最近标题、id 与时间；键入内容按标题或 id 过滤，↑/↓ 移动，Enter 恢复，Esc 关闭。`/resume <id>` 仍可直接恢复。其他语法有效的命令行会转发给 `ctx.commands`，因此 `/compact`、`/goal`、`/plan` 等 Agent 侧命令仍使用 base 中组合的实现。`/clear` 只丢弃已渲染条目；Session 历史与模型上下文不变。`/new` 会回到未启动的提示界面并释放当前 Agent，下一条提示才创建新 Session；`/resume` 在新 Agent 发布后才释放旧 Agent，因此恢复失败会保留当前对话。

<a id="configuration"></a>
## 配置

| 字段 | 默认值 | 含义 |
|---|---:|---|
| `streamFrameMs` | `50` | 流式渲染更新的最大间隔；`0` 表示每个 chunk 都渲染 |
| `toolOutputLines` | `12` | 每个工具卡片保留的结果行数，超出后截断 |
| `diffContextLines` | `3` | 每个文件 diff 保留的未变更上下文行数 |
| `diffMaxLines` | `2000` | 单侧行数上限，超过后退化为一个整体替换 hunk |
| `maxTranscriptMessages` | `400` | 内存转录超过此上限时丢弃最旧的已渲染条目 |
| `historyLimit` | `200` | 保留在 `$DSH_HOME/tui/history.json` 的输入历史条数；`0` 关闭历史 |
| `toolOutputChars` | `64000` | 每次调用保留的尾部实时工具输出字符数；`0` 隐藏实时输出 |

生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-tui)是受支持字段的完整来源。

<a id="concepts"></a>
## 概念

运行时拥有一个 `TuiSnapshot`：Session id（首条提示前为空）、工作目录、模型路线、选中的推理等级、解析出的上下文窗口、上下文与累计 token 计数、生命周期状态、转录条目、活动流、待处理审批、待处理提问、待处理选择列表与回合号。头部显示模型路线与推理等级；状态栏显示上下文使用量/窗口及百分比、推理等级与生命周期。转录条目包括用户提示、持有有序文本/推理/工具块的助手消息，以及终端通知。工具块留在其助手消息内；后续 `tool/result` 按 call id 把输出、失败与展示用 diff 附加到该块。当模型调用经由已组合的后台 job 执行时，job 的保留输出会流入该待处理块，卡片显示最新行。

转录为空时，对话区会在品牌字标上方居中显示 DeepSeek Harness 的 fish 标记（官方 logo 路径的终端字符描摹）与首条提示。首条转录出现后 banner 消失，`/clear` 后重新出现。

审批使用 `ctx.approval` 的一次性词汇。`y` 或 Enter 允许该确切请求；`n` 或 Escape 拒绝。该 seam 没有持久的“始终允许”，因此终端刻意不提供；需要长期策略时请使用权限预设。面板用请求的 call id 关联已记录的 `tool/call` 参数，并向工具的 `presentCall` 询问待处理呈现：文件改动显示有界 diff，Shell 调用显示命令与工作目录。

提问来自 `ctx.userQuestions`。数字键切换选项，键入文本成为自定义答案，Enter 提交，Left/Right 在批次内切换问题。已回答的批次会解除等待中的工具调用；Ctrl+C 取消回合并撤回未回答的问题。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>运行时、状态折叠与渲染</summary>

`src/runtime.ts` 拥有 Agent handle、模型选择引用和全部订阅。它注册 `session/event`、`agent/assistant-stream`、`agent/status`、`agent/error`、`approval/request` 与 `user-questions/request` 监听器；每个处理器都按当前确切 Agent 过滤。运行时只通过不可变快照替换通知 `useSyncExternalStore` 订阅者，因此 React 不会看到部分状态。

`src/state/state.ts` 包含纯折叠：用户与助手消息追加、工具结果附加、token 累计、回合关闭、流更新、转录限界与问题选择。`src/commands.ts` 解析共享斜杠语法，并在窄接口 `CommandHost` 上实现终端自有命令；未知名称返回运行时交给 `ctx.commands.execute`。

`src/components/` 是 Ink 树。头部与状态栏固定；对话底部对齐，并用 `overflowY="hidden"` 裁剪到剩余行数；输入框保持草稿挂载，但在提示面板占用输入时不可交互。`src/markdown.ts` 解析围栏代码、标题、列表、引用与行内强调；`src/diff.ts` 从前后文本生成带上下文的 hunk，并把超大文件退化为一个整体替换 hunk。`src/terminal.ts` 以 `exitOnCtrlC: false` 挂载 Ink，在释放 Agent 前卸载，并把退出请求映射到 `ctx.appExit`。

模型文本流按 `streamFrameMs` 合并。后台 job 输出在注册表报告推进时通过 `ctx.jobs.readAt` 读取，用 `job/registered.toolCall.callId` 关联到调用，并由最终 `tool/result` 替换。已提交的 `assistant/message` 替换活动流并贡献 usage；结束的 attempt 会清除它。输入框立即插入本地回显，并按文本与持久的 `user/message` 对账，因此较慢的持久化检查点不会隐藏提示。

</details>

<a id="further-exploration"></a>
## 进一步探索

- [终端界面子系统](../../../docs/subsystems/tui.zh.md) —— 快照、事件来源与交互流程。
- [Agent 服务](../../core/agent/README.zh.md) —— `ctx.agents`、`Agent` handle 与 `agent/*` 事件。
- [Session 服务](../../core/session/README.zh.md) —— 持久日志、`deriveMessages()` 与 `session/event`。
- [命令](../../interaction/commands/README.zh.md)、[审批](../../interaction/user-approval/README.zh.md)与[用户提问](../../interaction/user-questions/README.zh.md) —— 共享的人类交互 seam。
- [应用启动](../../../docs/architecture.zh.md#application-launch) —— profile 组合与启动器的内层参数契约。

<a id="model-experience"></a>
## 模型体验

### 对话与命令

#### 模型看到什么

界面不添加提示段、工具或消息变换。输入框提交通过 `Agent.followup()` 成为普通的已标识用户消息；斜杠命令要么在终端内解析，要么经 `ctx.commands` 执行而不进入模型历史。`/model` 更新 Agent 作用域的模型选择，之后第一条不同路线的请求会携带共享的模型切换通知。

#### Token 影响

只有提交的提示与模型自身的响应进入历史。终端通知、审批面板、提问面板与本地命令输出不增加请求 token。

#### KV Cache 影响

界面从不改写 Session 前缀。切换模型只按核心模型选择契约改变后续请求头。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **每个终端只有一个 Agent。** 会话切换会替换被驱动的 Agent；没有多 Agent 或子 Agent 面板。
- **不连接常驻 Host。** 界面启动自己的 profile 树，不连接已在运行的 Web 或 Desktop Host。
- **只有一次性审批。** 审批 seam 没有记忆授权，因此终端无法提供“始终允许”。
- **纯终端资产。** 图片显示为占位符；附件输入、鼠标点击/选择、转录搜索、复制操作与丰富的 diff 接受/拒绝控件尚未实现。滚轮滚动已支持。
- **模型列表来自已组合 provider 的目录。** 目录读取失败的 provider 会被省略；终端不保留回退列表。
- **输入历史是全局的。** 条目跨 Session 与目录持久化在 `$DSH_HOME/tui/history.json`，受 `historyLimit` 限制；文件损坏时会报告，并在下次提交时重写。
- **无语法高亮。** 代码块保留语言标签并截断长行；着色留待后续。
- **仅终端呈现。** 工具卡片从原始参数、结果内容与持久元数据推导，不调用工具定义的 presenter。
- **拒绝 preset 与子会话。** 该 profile 不组合 agent preset 名单，因此记录了 preset 选择的 Session 不能在此恢复；子 Agent 与 fork 子会话也会被拒绝。
- **恢复会替换已渲染历史。** 打开 Session 会把其持久事件重放到转录；超出配置消息上限的事件不会保留。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 —— 点击展开</summary>

无。

</details>
