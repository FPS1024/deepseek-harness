---
description: "终端包分组：以 dsh tui 交付的终端界面、React + Ink 渲染层，以及连接核心 Agent、Session、命令、审批与提问服务的桥接层。"
kind: "package-group"
---

# tui/ — 终端界面

[English](README.md) | 中文

## 摘要

`tui/` 分组提供以 `tui` profile 交付的终端界面。`dsh tui` 通过核心注册表创建或恢复一个 Agent，并用 React + Ink 渲染对话，包括流式文本、推理、工具调用与结果、文件 diff、审批、提问、斜杠命令和会话切换。Agent 逻辑、持久化、工具与审批仍由已组合的核心包负责；终端只投影它们的事件并分发用户命令。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发者笔记](#dev-note)

-----

<a id="packages"></a>
## 包

| 包 | 职责 |
|---|---|
| [`tui/`](tui/README.zh.md) | `dsh tui` profile bundle，以及覆盖核心运行时的 React + Ink 前端 |

-----

<a id="related-documentation"></a>
## 相关文档

- [终端界面子系统](../../docs/subsystems/tui.zh.md) —— 运行时快照、事件折叠、提示面板、布局与命令分发。
- [核心包](../core/README.zh.md) —— 界面消费的 Agent 注册表、AgentLoop、Session 日志与工具注册表。
- [交互平面](../interaction/README.zh.md) —— 界面应答的共享命令、审批与提问服务。
- [应用启动](../../docs/architecture.zh.md#application-launch) —— 每个 `dsh` 界面都遵循的 profile 规则。

<a id="dev-note"></a>
## 开发者笔记

<details>
<summary>维护者工作上下文 —— 点击展开</summary>

无。

</details>
