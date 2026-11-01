/**
 * Terminal-view types shared by the TUI runtime, its reducer, and its React
 * components. Nothing here references Ink or Cordis, so the state layer can be
 * exercised without a terminal.
 * @module @deepseek-ai/dsh-tui/types
 */

import type { AskUserQuestionItem } from '@deepseek-ai/dsh-user-questions/types'
import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval/types'

/** Lifecycle shown in the status bar. */
export type TuiStatus = 'starting' | 'idle' | 'running' | 'stopped'

/** One validated file change carried by a tool result's presentation metadata. */
export interface TuiFileDiff {
  readonly path: string
  /** Prior content, or null when the change created the file. */
  readonly oldText: string | null
  readonly newText: string
}

/** Completed or pending state of one model-requested tool call. */
export type TuiToolStatus = 'pending' | 'success' | 'error' | 'cancelled'

/** One tool invocation rendered inside an assistant message. */
export interface TuiToolBlock {
  readonly type: 'tool'
  readonly callId: string
  readonly name: string
  /** Raw JSON arguments exactly as the model produced them. */
  readonly input: string
  readonly status: TuiToolStatus
  readonly output?: string
  readonly error?: string
  readonly diffs?: readonly TuiFileDiff[]
}

/** One ordered block of a rendered assistant message. */
export type TuiAssistantBlock =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'reasoning'; readonly text: string }
  | TuiToolBlock

/** One conversation entry retained for the terminal transcript. */
export type TuiTranscriptMessage =
  | { readonly id: string; readonly role: 'user'; readonly text: string }
  | { readonly id: string; readonly role: 'assistant'; readonly blocks: readonly TuiAssistantBlock[] }
  | { readonly id: string; readonly role: 'system'; readonly kind: 'info' | 'error'; readonly text: string }

/** Live assistant text and reasoning that has not yet committed to the log. */
export interface TuiStreamingView {
  readonly turn: number
  readonly step: number
  readonly text: string
  readonly reasoning: string
}

/** One rendered line of an approval's call detail. */
export interface TuiPermissionDetail {
  readonly kind: 'path' | 'hunk' | 'added' | 'removed' | 'context' | 'truncated'
  readonly text: string
}

/** A pending one-shot approval question. */
export interface TuiPermissionView {
  readonly id: string
  readonly toolName: string
  readonly reason?: string
  /** Tool-owned title for the pending call, when its presenter supplies one. */
  readonly title?: string
  /** One-line summary above a terminal card. */
  readonly description?: string
  /** Shell command the call runs. */
  readonly command?: string
  /** Working directory the command runs in. */
  readonly cwd?: string
  /** Bounded diff preview derived from the tool's pending-call presentation. */
  readonly details?: readonly TuiPermissionDetail[]
}

/** One answer being assembled for a `user-questions/request` batch. */
export interface TuiQuestionView {
  readonly id: string
  readonly questions: readonly AskUserQuestionItem[]
  /** Selected option labels per question id. */
  readonly selected: Readonly<Record<string, readonly string[]>>
  /** Free-text answer per question id. */
  readonly custom: Readonly<Record<string, string>>
  /** Index of the question receiving input. */
  readonly active: number
}

/** One slash command offered by the composer's prediction list. */
export interface TuiCommandInfo {
  /** Lowercase command name without the leading slash. */
  readonly name: string
  /** One-line explanation shown beside the name. */
  readonly description: string
  /** Optional input hint, such as `<model>`. */
  readonly hint?: string
}

/** One resumable Session row in the terminal picker. */
export interface TuiSessionChoice {
  readonly id: string
  /** Latest persisted or generated title, when the log has one. */
  readonly title?: string
  /** Unix epoch milliseconds when the Session was created. */
  readonly createdAt: number
  /** Recorded execution directory. */
  readonly cwd: string
  /** Whether the Session currently has a live Agent in this process. */
  readonly live: boolean
}

/** One model offered by the `/model` picker. */
export interface TuiModelChoice {
  readonly provider: string
  readonly model: string
  /** Display name reported by the provider catalog. */
  readonly name: string
  /** Optional provider description. */
  readonly description?: string
}

/** One reasoning-effort row; an empty id means the provider default. */
export interface TuiEffortChoice {
  readonly id: string
  readonly name: string
}

/** Two-step `/model` picker state. */
export type TuiModelPicker =
  | {
    readonly step: 'model'
    readonly models: readonly TuiModelChoice[]
    readonly index: number
  }
  | {
    readonly step: 'effort'
    readonly provider: string
    readonly model: string
    readonly name: string
    readonly efforts: readonly TuiEffortChoice[]
    readonly index: number
  }

/** Pending `/resume` selection list. */
export interface TuiSessionPicker {
  /** Every resumable Session; the query selects the rendered subset. */
  readonly sessions: readonly TuiSessionChoice[]
  /** Case-insensitive id or title filter typed into the picker. */
  readonly query: string
  /** Index of the highlighted row within the filtered subset. */
  readonly index: number
}

/** Accumulated token accounting from committed assistant messages. */
export interface TuiTokenTotals {
  readonly input: number
  readonly output: number
  readonly cacheRead: number
  readonly cacheWrite: number
  readonly reasoning: number
  readonly total: number
}

/** Immutable render state observed by the React tree. */
export interface TuiSnapshot {
  readonly sessionId: string
  readonly cwd: string
  readonly provider: string
  readonly model: string
  readonly status: TuiStatus
  readonly transcript: readonly TuiTranscriptMessage[]
  readonly streaming: TuiStreamingView | undefined
  readonly permission: TuiPermissionView | undefined
  readonly question: TuiQuestionView | undefined
  readonly picker: TuiSessionPicker | undefined
  readonly modelPicker: TuiModelPicker | undefined
  /** Provider route's context window, when its metadata reports one. */
  readonly contextWindow: number | undefined
  /** Prompt plus output tokens of the most recent request, when reported. */
  readonly contextTokens: number
  /** Selected reasoning effort, absent when the provider default applies. */
  readonly reasoningEffort: string | undefined
  readonly tokens: TuiTokenTotals
  readonly turn: number
}

/** Validated deployment knobs read from the profile row. */
export interface TuiConfig {
  /** Maximum interval between streamed render updates; zero renders each chunk. */
  readonly streamFrameMs: number
  /** Result lines retained per tool card before truncation. */
  readonly toolOutputLines: number
  /** Context lines kept around each diff change. */
  readonly diffContextLines: number
  /** Per-side line ceiling before a diff degrades to one replacement hunk. */
  readonly diffMaxLines: number
  /** Oldest messages dropped once the in-memory transcript exceeds this size. */
  readonly maxTranscriptMessages: number
  /** Maximum composer history entries retained in durable storage; zero disables history. */
  readonly historyLimit: number
  /** Trailing characters of live tool output retained per call; zero hides live output. */
  readonly toolOutputChars: number
}

/** Process-facing effects of the terminal surface. */
export interface TuiIo {
  readonly stdin: NodeJS.ReadStream
  readonly stdout: NodeJS.WriteStream
  readonly stderr: NodeJS.WriteStream
  /** Request bounded process exit after terminal cleanup. */
  exit(code: number): void
}

/** Commands the React tree may invoke on the surface runtime. */
export interface TuiController {
  /** Observe snapshot replacements. */
  subscribe(listener: () => void): () => void
  /** Read the current snapshot. */
  getSnapshot(): TuiSnapshot
  /** Slash commands with their explanations, for prediction and completion. */
  commandCatalog(): readonly TuiCommandInfo[]
  /** Read composer history loaded from durable storage. */
  history(): readonly string[]
  /** Record one submitted composer line. */
  remember(text: string): void
  /** Open the `/resume` session picker. */
  openSessionPicker(): Promise<void>
  /** Open the `/model` picker. */
  openModelPicker(): Promise<void>
  /** Move the model picker highlight. */
  moveModelPicker(delta: number): void
  /** Confirm the highlighted model or effort. */
  confirmModelPicker(): Promise<void>
  /** Dismiss the model picker. */
  closeModelPicker(): void
  /** Move the picker highlight. */
  movePicker(delta: number): void
  /** Replace the picker's id or title filter. */
  setPickerQuery(query: string): void
  /** Dismiss the picker without resuming. */
  closePicker(): void
  /** Resume the highlighted Session. */
  confirmPicker(): void
  /** Submit composer text. */
  submit(text: string): Promise<void>
  /** Abort the active turn. */
  interrupt(): void
  /** Answer the head approval question. */
  resolvePermission(outcome: ApprovalOutcome): void
  /** Select or deselect one option on the active question. */
  toggleQuestionOption(label: string): void
  /** Replace the active question's free-text answer. */
  setQuestionCustom(text: string): void
  /** Move between questions in a batch. */
  stepQuestion(delta: number): void
  /** Submit the assembled question answers. */
  submitQuestion(): void
}
