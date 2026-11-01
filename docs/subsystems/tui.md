# Terminal Surface

English | [中文](tui.zh.md)

The terminal surface from [`dsh-tui`](../../packages/tui/tui/README.md). It is the shipped `tui` profile: `dsh-base` composes the Agent registry, AgentLoop, Session persistence, tools, sandbox, credentials, approvals, questions, and commands; the `dsh-tui` bundle adds one frontend row. The frontend creates or resumes one Agent and renders its events; it owns no Agent logic, model request, tool, or durable state.

Source: [`packages/tui/tui/src`](../../packages/tui/tui/src)

## Launch and lifetime

`dsh tui [--resume <id>] [--model <name>]` boots the profile through the ordinary launcher. The inner arguments are read from `ctx.cmdlineArgs`; `--help` prints the surface's own help and exits before Ink mounts. A non-TTY stdin fails with an actionable diagnostic instead of rendering a non-interactive frame.

On start the runtime resolves the working directory, waits for the Loader to settle, and resolves the default model route. It creates a fresh `session-<uuid>` only when the first prompt or agent-side command needs an Agent, so launching and exiting without input leaves no stored Session. `--resume` calls `ctx.agents.resume()` for the exact requested id immediately. The resumed route comes from the last durable `request/header`; `--model` overrides it. The Agent-scoped `installModelSelection()` listener makes later `/model` changes effective on the next step without rewriting the Session prefix.

The final `AgentHandle.dispose()` releases the Agent. The terminal flushes the Session first, restores the terminal by unmounting Ink, and only then requests `ctx.appExit`.

## Snapshot

One immutable snapshot drives the React tree. Every render reads it through `useSyncExternalStore`; the runtime replaces the object only after a complete fold.

| Field | Content |
|---|---|
| `sessionId`, `cwd` | Current Session identity and execution directory |
| `provider`, `model` | Active route shown in the header |
| `reasoningEffort` | Selected effort, absent for the provider default |
| `contextWindow`, `contextTokens` | Resolved window and the latest request's prompt-plus-output tokens |
| `modelPicker` | Pending two-step model chooser, when open |
| `status` | `starting`, `idle`, `running`, or `stopped` |
| `transcript` | User prompts, assistant messages, and terminal notices |
| `streaming` | Live assistant text and reasoning not yet committed |
| `permission` | Head pending approval, when any |
| `question` | Head pending question batch, when any |
| `tokens` | Accumulated input, output, cache, reasoning, and total counts |
| `turn` | Current durable turn number |

An assistant message holds ordered text, reasoning, and tool blocks. A tool result attaches to its block by `callId`; a result with no rendered call is ignored rather than shown as a detached card. Terminal notices carry an `info` or `error` kind. The transcript keeps at most `maxTranscriptMessages` entries; dropping old entries never touches the Session log.

## Event sources

The runtime subscribes to six Cordis events and filters every listener on the exact current Agent. It also observes `ctx.jobs.events` for the current Session when the jobs service is composed.

| Event | Fold |
|---|---|
| `session/event` | `turn/start`, `turn/end`, `user/message`, `assistant/message`, `assistant/attempt`, `tool/call`, `tool/result`, `request/header`, `job/registered`, `job/settled` |
| `agent/assistant-stream` | Live text and reasoning deltas; start, chunk, and end frames |
| `agent/status` | `idle` and `running` in the status bar |
| `agent/error` | An error transcript notice |
| `approval/request` | A queued approval panel |
| `user-questions/request` | A queued question panel |

A durable `user/message` reconciles the optimistic echo by text, so the prompt appears on submission without waiting for the persistence checkpoint. An `assistant/message` clears the matching live stream and adds its usage to the token totals. `turn/end` closes the status, clears pending prompts, and renders a failure or interruption notice; a failure already rendered by `agent/error` is not repeated.

## Streaming

`agent/assistant-stream` carries process-local presentation frames. The runtime keeps one live frame per turn and step, appends `text-delta` and `reasoning-delta` chunks, and emits at most once per `streamFrameMs`. The terminal does not write raw chunks to stdout; Ink renders the accumulated frame. A committed `assistant/message` replaces the live frame; an abandoned attempt clears it.

A live background job streams into its pending tool card. `job/registered` maps the job id to `toolCall.callId`; each `output` event on `ctx.jobs.events` triggers a non-consuming `readAt` from that job's cursor, and the joined text is appended to the block. `job/settled` drains once more and drops the mapping. The retained suffix is bounded by `toolOutputChars`, the pending card shows its newest `toolOutputLines` lines, and the final `tool/result` replaces the streamed text.

## Tools and diffs

Tool cards derive from recorded data, never from a live tool definition. The card shows the model-facing name, a compact argument summary (`command`, `path`, or JSON for unknown tools), a status glyph, the first `toolOutputLines` result lines, and the failure reason when the result is an error. A tool whose `tool/result.meta.diffs` carries validated `{ path, oldText, newText }` entries renders contextual hunks computed by the surface's bounded line-diff algorithm; oversized files degrade to one replacement hunk.

## Approvals and questions

The surface is one answerer among the composed chain. `y` or Enter returns `allowed-once`; `n` or Escape returns `rejected`. The approval seam has no remembered grant, so no "always allow" is offered. Requests for another Agent delegate to `next()`. The panel joins the request's call id with the runtime's `tool/call` arguments and calls the matching tool definition's `presentCall`, rendering a bounded diff preview for file mutations or the command and working directory for terminal calls.

Question panels show one active question of a batch, its optional detail, numbered options, and a custom-text field. Number keys toggle options, printable text edits the custom answer, Enter submits, and Left/Right move between questions. Submitting answers the full batch; a question with options that has neither a selection nor custom text keeps the panel open. An aborted signal rejects the waiting request. When several approval or question requests overlap, each queues; the panel shows the first and advances when it settles.

## Commands and Sessions

Terminal-owned commands are `/help`, `/model`, `/session`, `/sessions`, `/resume`, `/new`, `/clear`, `/context`, `/tools`, `/status`, and `/exit`. `/model` opens a two-step chooser: the model catalog, then the selected model's reasoning efforts with a `default` row. Enter confirms the highlighted row, Escape closes, and a model whose metadata advertises no efforts applies immediately. The selection updates the next request route and saves the deployment default; a save failure keeps the Session selection and reports the failure. Other valid lines start the Agent if needed and go to `ctx.commands.execute(agent, line, [], signal)`, preserving agent-side commands such as `/compact`. An invalid or unknown line produces a notice and never becomes a prompt.

Typing `/` opens a prediction list of terminal-owned and registered commands with their one-line explanations. ↑/↓ moves the selection, Tab completes it, Enter runs an exact command or completes a unique prefix first, and Escape dismisses the list. When the list is open, ↑/↓ belongs to it rather than to history. Submitted lines are recorded in `$DSH_HOME/tui/history.json`, capped by `historyLimit`, and loaded when the surface starts.

`/resume` without an id opens a picker of stored Sessions recorded in the current directory; the picker shows each Session's latest title when recorded plus its id and timestamp, and excludes the current Session, subagent and forked children, and sessions that record a preset. Typing filters by title or id, ↑/↓ moves, Enter resumes, and Escape closes it. `/resume <id>` resumes directly. A failed open leaves the current conversation in place. `/new` returns to the unstarted prompt screen and disposes the current Agent; the next prompt starts a fresh Session. Both refuse while a turn is running. `/clear` discards rendered entries only.

## Layout

An empty transcript centers the brand fish mark and wordmark in the conversation viewport; the banner disappears at the first entry and returns after `/clear`. The mark is a terminal-cell trace of the official logo path and chooses a full or compact rendition from the terminal width.

The header shows the product name, route, and reasoning effort; the status bar shows a shortened working directory, context used/window with its percentage, the effort, and lifecycle. A route without a reported window falls back to its context token count, and `/context` repeats the full accounting. The conversation fills the remaining rows, bottom-aligned and clipped with `overflowY="hidden"`; each entry opts out of flex shrinking so clipping keeps the tail. PageUp and PageDown move the retained window by whole entries, and the mouse wheel moves it by one entry per notch through SGR mouse reporting enabled only on the process TTY. The composer stays mounted with its draft while a prompt or the picker owns input but ignores keystrokes. Typing a slash command grows the composer by at most six prediction rows; the conversation shrinks by the same count.

Terminal width and height come from the active stdout and follow resize events. A PTY reporting zero-sized dimensions falls back to 80×24.

## Failure behavior

A startup failure after Ink mounts unmounts the terminal, writes the diagnostic to stderr, and requests a failing exit. Invalid launcher options print the surface help and exit 1. An in-flight approval or question is withdrawn with `cancelled` or a rejection when its turn ends or its signal aborts. Session flush or Agent close failures are reported on stderr after the terminal is restored; they do not silently claim a clean shutdown.

## Limits

The surface drives one Agent and does not attach to a resident Web or Desktop Host. It renders no images, accepts no attachments, handles no mouse clicks or text selection, performs no transcript search, and offers no syntax highlighting or diff accept/reject actions. Tool presentation reads raw recorded data, so a tool's Host-local presenter is not used here.
