---
description: "The dsh terminal surface: a React + Ink frontend over the core Agent registry, Session log, command registry, approval seam, and user-question seam."
kind: "package-bundle"
---

# @deepseek-ai/dsh-tui

English | [中文](README.zh.md)

## Summary

`dsh-tui` is the interactive terminal surface shipped as the `tui` profile. It creates or resumes one Agent through `ctx.agents`, folds `session/event` and `agent/assistant-stream` into an immutable render snapshot, and draws that snapshot with React + Ink. Composer input becomes either an ordinary Agent follow-up or a slash command; approval and user-question requests pause the composer until the user decides. Agent execution, persistence, tools, and policy remain in the composed core packages, so the surface never imports the AgentLoop or runs a model request itself.

## Table of Contents

- [Use this package](#use-this-package)
- [Configuration](#configuration)
- [Concepts](#concepts)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

Boot the shipped profile from an interactive terminal:

```sh
dsh tui
dsh tui --resume session-abc
dsh tui --model deepseek-reasoner
dsh tui --model deepseek-official/deepseek-chat
dsh tui --help
```

`--resume` (`-r`) adopts an exact stored Session; the route recorded in its latest request header becomes the active model unless `--model` overrides it. Without `--resume`, the surface starts without a stored Session; the first prompt or agent-side command creates `session-<uuid>`, and launching then exiting without input stores nothing. A non-TTY stdin, an unknown option, or a missing flag value fails before Ink mounts.

The bundle declares `dsh.bundle.patch`; the shipped `tui` template stacks [`dsh-base`](../../bundle/base/README.md) and this bundle. The base supplies the AgentLoop, Session persistence, tools, sandbox, credentials, approval service, and command registry. The patch sets the shared coding persona, keeps the temporary `DSH_TOOLS_MODE` process opt-in, inserts the `tui` row, and disables HMR.

### Keys

| Key | Action |
|---|---|
| Enter | Send the composer text |
| Shift+Enter | Insert a newline |
| Ctrl+C | Cancel the active turn (queued input is preserved) |
| Ctrl+D | Exit the terminal |
| PageUp / PageDown | Scroll the transcript by three entries |
| Mouse wheel | Scroll the conversation viewport (hold Shift to select text in most terminals) |
| Ctrl+T | Expand or collapse reasoning blocks |
| Tab | Complete the selected slash command |
| ↑ / ↓ | Move through open predictions, then recall composer history |
| ← / → | Move the composer cursor |

### Commands

The terminal owns `/help`, `/model`, `/session`, `/sessions`, `/resume`, `/new`, `/clear`, `/context`, `/tools`, `/status`, and `/exit`. `/model` opens a two-step chooser: select a model, then a reasoning effort (`default` plus the efforts the adapter advertises, such as Off/Low/High/Max). `/model <model>` or `/model <provider>/<model>` still switches directly and clears the effort override. Typing `/` opens a live prediction list with each command's one-line explanation; ↑/↓ selects, Tab completes, Enter runs an exact command or completes a unique prefix first, and Escape dismisses the list. `/resume` without an id opens a picker of stored Sessions from this directory, showing each Session's latest title when recorded, its id, and its timestamp; typing filters by title or id, ↑/↓ moves, Enter resumes, and Escape closes it. `/resume <id>` still resumes directly. Every other syntactically valid command line is forwarded to `ctx.commands`, so agent-side commands such as `/compact`, `/goal`, and `/plan` keep the implementation composed in base. `/clear` drops rendered entries only; Session history and the model context are unchanged. `/new` returns to the unstarted prompt screen and disposes the current Agent; the next prompt starts a fresh Session. `/resume` disposes the old Agent only after the replacement is published, so a failed resume leaves the current conversation intact.

<a id="configuration"></a>
## Configuration

| Field | Default | Meaning |
|---|---:|---|
| `streamFrameMs` | `50` | Maximum interval between streamed render updates; `0` renders every chunk |
| `toolOutputLines` | `12` | Retained result lines per tool card before truncation |
| `diffContextLines` | `3` | Unchanged lines kept around each file diff |
| `diffMaxLines` | `2000` | Per-side line ceiling before a diff degrades to one replacement hunk |
| `maxTranscriptMessages` | `400` | Oldest rendered entries dropped when the in-memory transcript grows past this bound |
| `historyLimit` | `200` | Composer history entries retained in `$DSH_HOME/tui/history.json`; `0` disables history |
| `toolOutputChars` | `64000` | Trailing live tool-output characters retained per call; `0` hides live output |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-tui) is the exhaustive source for accepted fields.

<a id="concepts"></a>
## Concepts

The runtime owns one `TuiSnapshot`: Session id (empty until the first prompt), working directory, route, selected reasoning effort, resolved context window, context and cumulative token counts, lifecycle status, transcript entries, the live stream, pending approval, pending question, pending pickers, and turn number. The header shows the model route and effort; the status bar shows context used/window with its percentage, the effort, and the lifecycle. Transcript entries are user prompts, assistant messages holding ordered text/reasoning/tool blocks, and terminal notices. A tool block stays inside its assistant message; the later `tool/result` attaches output, failure, and presentation diffs to that block by call id. While a modeled call runs through a composed background job, the job's retained output streams into that pending block and the card shows its newest lines.

While the transcript is empty, the conversation area centers the DeepSeek Harness fish mark — a terminal-cell trace of the official logo path — above the wordmark and the first-prompt hint. The banner disappears with the first transcript entry and returns after `/clear`.

Approvals use `ctx.approval`'s one-shot vocabulary. `y` or Enter allows the exact request; `n` or Escape rejects it. The seam has no durable "always allow", so the terminal deliberately offers none; use the permission preset for a standing policy. The panel correlates the request's call id with the logged `tool/call` arguments and asks the tool's `presentCall` for its pending presentation, so a file mutation shows a bounded diff and a shell call shows its command and working directory.

Questions come from `ctx.userQuestions`. Number keys toggle an option, typed text becomes the custom answer, Enter submits, and Left/Right move between a batch's questions. An answered batch resolves the waiting tool call; Ctrl+C cancels the turn and withdraws the unanswered question.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Runtime, state folding, and rendering</summary>

`src/runtime.ts` owns the Agent handle, the model-selection reference, and every subscription. It registers listeners for `session/event`, `agent/assistant-stream`, `agent/status`, `agent/error`, `approval/request`, and `user-questions/request`; each handler filters on the exact current Agent. The runtime notifies `useSyncExternalStore` subscribers only through immutable snapshot replacements, so React never observes partial state.

`src/state/state.ts` contains the pure folds: user and assistant message append, tool-result attachment, token accumulation, turn closure, stream updates, transcript bounding, and question selection. `src/commands.ts` parses the shared slash grammar and implements the terminal-owned commands over a narrow `CommandHost`; unknown names return to the runtime for `ctx.commands.execute`.

`src/components/` is the Ink tree. The header and status bar are fixed; the conversation is bottom-aligned and clipped to the remaining rows with `overflowY="hidden"`; the composer keeps its draft mounted but inert while a prompt owns input. `src/markdown.ts` parses fenced code, headings, lists, quotes, and inline emphasis; `src/diff.ts` produces contextual hunks from before/after text and degrades oversized files to one replacement hunk. `src/terminal.ts` mounts Ink with `exitOnCtrlC: false`, unmounts before releasing the Agent, and maps exit requests onto `ctx.appExit`.

Streaming model text is coalesced at `streamFrameMs`. Job output is read from `ctx.jobs.readAt` as the registry reports advancement, joined to the call through `job/registered.toolCall.callId`, and replaced by the final `tool/result`. A committed `assistant/message` replaces the live stream and contributes usage; an ended attempt clears it. The composer inserts a local echo immediately and reconciles it with the durable `user/message` by text, so a slow persistence checkpoint does not hide the prompt.

</details>

<a id="further-exploration"></a>
## Further Exploration

- [Terminal surface subsystem](../../../docs/subsystems/tui.md) — the snapshot, event sources, and interaction flow.
- [Agent service](../../core/agent/README.md) — `ctx.agents`, the `Agent` handle, and the `agent/*` events.
- [Session service](../../core/session/README.md) — the durable log, `deriveMessages()`, and `session/event`.
- [Commands](../../interaction/commands/README.md), [approval](../../interaction/user-approval/README.md), and [user questions](../../interaction/user-questions/README.md) — the shared human-interaction seams.
- [Application launch](../../../docs/architecture.md#application-launch) — profile composition and the launcher's inner-argument contract.

<a id="model-experience"></a>
## Model Experience

### Conversation and commands

#### What the model sees

The surface adds no prompt sections, tools, or message transformations. A composer submission becomes an ordinary identified user message through `Agent.followup()`; a slash command either resolves in the terminal or executes through `ctx.commands` without entering model history. `/model` updates the Agent-scoped selection, and the first later request at a different route carries the shared model-switch notice.

#### Token effect

Only submitted prompts and the model's own responses enter history. Terminal notices, approval panels, question panels, and local command output add no request tokens.

#### KV Cache effect

The surface never rewrites the Session prefix. Switching models changes later request headers exactly as the core model-selection contract specifies.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **One Agent per terminal.** Session switching replaces the driven Agent; there is no multi-Agent or subagent panel.
- **No resident-host attachment.** The surface boots its own profile tree. It does not connect to an already-running Web or Desktop Host.
- **One-shot approvals only.** The approval seam has no remembered grant, so the terminal cannot offer "always allow".
- **Plain terminal assets.** Images render as placeholders; attachment input, mouse clicks/selection, transcript search, copy actions, and rich diff accept/reject controls are not implemented. Wheel scrolling is supported.
- **The model list is the composed providers' catalogs.** A provider whose catalog lookup fails is omitted; the terminal does not keep a fallback list.
- **Composer history is global.** Entries persist in `$DSH_HOME/tui/history.json` across Sessions and directories, bounded by `historyLimit`; a corrupt file is reported and replaced from the next submission.
- **No syntax highlighting.** Code blocks keep their language label and truncate long lines; token coloring is deferred.
- **Terminal-only presentation.** Tool cards derive from raw arguments, result content, and persisted metadata; they do not call a tool definition's presenter.
- **Preset and child Sessions are refused.** The profile composes no agent-preset roster, so a Session recording a preset selection cannot be resumed here; subagent and forked-child Sessions are refused too.
- **Rendered-entry history is replaced on resume.** Opening a Session replays its durable events into the transcript; events outside the configured message bound are not retained.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
