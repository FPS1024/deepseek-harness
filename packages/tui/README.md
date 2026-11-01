---
description: "The terminal package group: the shipped dsh tui surface, its React + Ink renderer, and the bridge to the core Agent, Session, command, approval, and question services."
kind: "package-group"
---

# tui/ — terminal surface

English | [中文](README.zh.md)

## Summary

The `tui/` group provides the terminal surface shipped as the `tui` profile. `dsh tui` creates or resumes one Agent through the core registry and renders the conversation with React + Ink, including streamed text, reasoning, tool calls and results, file diffs, approvals, questions, slash commands, and Session switching. Agent logic, persistence, tools, and approvals remain owned by the composed core packages; the terminal only projects their events and dispatches user commands.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role |
|---|---|
| [`tui/`](tui/README.md) | The `dsh tui` profile bundle and its React + Ink frontend over the core runtime |

-----

<a id="related-documentation"></a>
## Related documentation

- [Terminal surface subsystem](../../docs/subsystems/tui.md) — runtime snapshot, event folding, prompts, layout, and command dispatch.
- [Core packages](../core/README.md) — the Agent registry, AgentLoop, Session log, and tool registry the surface consumes.
- [Interaction plane](../interaction/README.md) — the shared command, approval, and question services the surface answers.
- [Application launch](../../docs/architecture.md#application-launch) — the profile rule every `dsh` surface follows.

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
