/**
 * Pure state transitions for the terminal transcript. The runtime owns one
 * snapshot and replaces it through these functions; React only reads it.
 * @module @deepseek-ai/dsh-tui/state
 */

import { randomUUID } from 'node:crypto'
import type { ContentBlock, TokenUsage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type {
  TuiAssistantBlock,
  TuiFileDiff,
  TuiModelPicker,
  TuiPermissionView,
  TuiQuestionView,
  TuiSessionChoice,
  TuiSessionPicker,
  TuiSnapshot,
  TuiStreamingView,
  TuiTokenTotals,
  TuiToolBlock,
  TuiToolStatus,
  TuiTranscriptMessage,
} from '../types.ts'

/** Empty token accounting. */
export const EMPTY_TOKENS: TuiTokenTotals = {
  input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, total: 0,
}

/**
 * Build the snapshot shown before the first Agent event.
 * @param input - initial Session identity, directory, provider, and model.
 * @returns a starting snapshot with an empty transcript and zero tokens.
 */
export function initialSnapshot(input: {
  sessionId: string
  cwd: string
  provider: string
  model: string
}): TuiSnapshot {
  return {
    ...input,
    status: 'starting',
    transcript: [],
    streaming: undefined,
    permission: undefined,
    question: undefined,
    picker: undefined,
    modelPicker: undefined,
    contextWindow: undefined,
    contextTokens: 0,
    reasoningEffort: undefined,
    tokens: EMPTY_TOKENS,
    turn: 0,
  }
}

function trim(messages: TuiTranscriptMessage[], max: number): readonly TuiTranscriptMessage[] {
  if (messages.length <= max) return messages
  return messages.slice(messages.length - max)
}

/**
 * Append one terminal notice and bound the retained transcript.
 * @param snapshot - current render state.
 * @param kind - informational or error presentation.
 * @param text - notice text.
 * @param max - maximum retained transcript entries.
 * @returns the next snapshot.
 */
export function withSystemNotice(
  snapshot: TuiSnapshot, kind: 'info' | 'error', text: string, max: number,
): TuiSnapshot {
  const message: TuiTranscriptMessage = { id: `notice-${randomUUID()}`, role: 'system', kind, text }
  return { ...snapshot, transcript: trim([...snapshot.transcript, message], max) }
}

/**
 * Append one user prompt to the transcript.
 * @param snapshot - current render state.
 * @param id - stable render identity for the entry.
 * @param text - prompt text; whitespace-only text is ignored.
 * @param max - maximum retained transcript entries.
 * @returns the next snapshot.
 */
export function withUserMessage(
  snapshot: TuiSnapshot, id: string, text: string, max: number,
): TuiSnapshot {
  if (text.trim() === '') return snapshot
  const message: TuiTranscriptMessage = { id, role: 'user', text }
  return { ...snapshot, transcript: trim([...snapshot.transcript, message], max) }
}

function userText(content: readonly ContentBlock[]): string {
  const parts: string[] = []
  for (const block of content) {
    if (block.type === 'text') parts.push(block.text)
    else if (block.type === 'image') parts.push('[image]')
    else if (block.type === 'file') parts.push('[file]')
  }
  return parts.join('\n')
}

/**
 * Extract user-visible text from durable message content.
 * @param content - model-facing content blocks.
 * @returns the concatenated text with attachment placeholders.
 */
export function userMessageText(content: readonly ContentBlock[]): string {
  return userText(content)
}

function assistantBlocks(content: readonly ContentBlock[]): TuiAssistantBlock[] {
  const blocks: TuiAssistantBlock[] = []
  for (const block of content) {
    switch (block.type) {
      case 'text':
        if (block.text !== '') blocks.push({ type: 'text', text: block.text })
        break
      case 'reasoning':
        if (block.text !== '') blocks.push({ type: 'reasoning', text: block.text })
        break
      case 'tool-call':
        blocks.push({
          type: 'tool', callId: block.id, name: block.name, input: block.arguments, status: 'pending',
        })
        break
      // Images, files, and developer tool updates have no terminal rendering.
      case 'image':
      case 'file':
      case 'tool-addition':
      case 'tool-removal':
        break
      /* v8 ignore next 3 -- merge-extensible content block types */
      default:
        break
    }
  }
  return blocks
}

/**
 * Append a committed assistant message and its token accounting.
 * @param snapshot - current render state.
 * @param event - durable `assistant/message` event.
 * @param max - maximum retained transcript entries.
 * @returns the next snapshot with any matching live stream cleared.
 */
export function withAssistantMessage(
  snapshot: TuiSnapshot,
  event: SessionEvent<'assistant/message'>,
  max: number,
): TuiSnapshot {
  const blocks = assistantBlocks(event.data.message.content)
  const tokens = event.data.usage === undefined ? snapshot.tokens : addTokens(snapshot.tokens, event.data.usage)
  const contextTokens = event.data.usage === undefined
    ? snapshot.contextTokens
    : event.data.usage.inputTokens
      + (event.data.usage.cacheReadTokens ?? 0)
      + (event.data.usage.cacheWriteTokens ?? 0)
      + event.data.usage.outputTokens
  const streaming = snapshot.streaming !== undefined
    && snapshot.streaming.turn === event.data.turn
    && snapshot.streaming.step === event.data.step
    ? undefined
    : snapshot.streaming
  if (blocks.length === 0) return { ...snapshot, tokens, contextTokens, streaming }
  const message: TuiTranscriptMessage = {
    id: `assistant-${String(event.seq)}`,
    role: 'assistant',
    blocks,
  }
  return { ...snapshot, transcript: trim([...snapshot.transcript, message], max), tokens, contextTokens, streaming }
}

function addTokens(totals: TuiTokenTotals, usage: TokenUsage): TuiTokenTotals {
  return {
    input: totals.input + usage.inputTokens,
    output: totals.output + usage.outputTokens,
    cacheRead: totals.cacheRead + (usage.cacheReadTokens ?? 0),
    cacheWrite: totals.cacheWrite + (usage.cacheWriteTokens ?? 0),
    reasoning: totals.reasoning + (usage.reasoningTokens ?? 0),
    total: totals.total + (usage.totalTokens ?? usage.inputTokens + usage.outputTokens),
  }
}

function toolStatus(isError: boolean | undefined, code: string | undefined): TuiToolStatus {
  if (isError !== true) return 'success'
  return code !== undefined && (code.startsWith('ABORT') || code.startsWith('CANCEL')) ? 'cancelled' : 'error'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFileDiff(value: unknown): value is TuiFileDiff {
  if (!isRecord(value)) return false
  return typeof value.path === 'string'
    && (value.oldText === null || typeof value.oldText === 'string')
    && typeof value.newText === 'string'
}

/**
 * Validate the optional persisted diff payload of one tool result.
 * @param meta - opaque `tool/result` metadata.
 * @returns validated file diffs, or undefined for absent or malformed data.
 */
export function resultDiffs(meta: unknown): readonly TuiFileDiff[] | undefined {
  if (!isRecord(meta) || !Array.isArray(meta.diffs) || meta.diffs.length === 0) return undefined
  return meta.diffs.every(isFileDiff) ? meta.diffs : undefined
}

/**
 * Extract display text from a tool result message.
 * @param content - model-facing result content.
 * @returns the concatenated text with attachment placeholders.
 */
export function toolResultText(content: readonly ContentBlock[]): string {
  const parts: string[] = []
  for (const block of content) {
    if (block.type === 'text') parts.push(block.text)
    else if (block.type === 'image') parts.push('[image result]')
    else if (block.type === 'file') parts.push('[file result]')
  }
  return parts.join('\n')
}

/**
 * Attach one durable tool result to the matching tool block anywhere in the
 * transcript. A result whose call is unknown is ignored rather than rendered
 * as a detached card.
 * @param snapshot - current render state.
 * @param callId - exact call identity to update.
 * @param result - output text, failure facts, and optional presentation diffs.
 * @returns the next snapshot, unchanged when no block matches.
 */
export function withToolResult(
  snapshot: TuiSnapshot,
  callId: string,
  result: {
    output: string
    isError: boolean | undefined
    code?: string
    reason?: string
    diffs?: readonly TuiFileDiff[]
  },
): TuiSnapshot {
  const matches = snapshot.transcript.some(message => message.role === 'assistant'
    && message.blocks.some(block => block.type === 'tool' && block.callId === callId))
  if (!matches) return snapshot
  const transcript = snapshot.transcript.map((message) => {
    if (message.role !== 'assistant') return message
    const blocks = message.blocks.map((block): TuiAssistantBlock => {
      if (block.type !== 'tool' || block.callId !== callId) return block
      const status = toolStatus(result.isError, result.code)
      const next: TuiToolBlock = {
        ...block,
        status,
        ...result.output === '' ? {} : { output: result.output },
        ...result.reason === undefined ? {} : { error: result.reason },
        ...result.diffs === undefined ? {} : { diffs: result.diffs },
      }
      return next
    })
    return { ...message, blocks }
  })
  return { ...snapshot, transcript }
}

/**
 * Mark a turn as started.
 * @param snapshot - current render state.
 * @param turn - durable turn number.
 * @returns the next snapshot with a running status.
 */
export function withTurnStart(snapshot: TuiSnapshot, turn: number): TuiSnapshot {
  return { ...snapshot, turn, status: 'running' }
}

/**
 * Close the current turn and render its outcome.
 * @param snapshot - current render state.
 * @param reason - durable turn-end reason.
 * @returns the next snapshot with the live stream cleared.
 */
export function withTurnEnd(snapshot: TuiSnapshot, reason: SessionEvent<'turn/end'>['data']['reason']): TuiSnapshot {
  const next: TuiSnapshot = { ...snapshot, status: 'idle', streaming: undefined }
  if (reason.kind === 'error') {
    const last = next.transcript.at(-1)
    // `agent/error` already rendered this failure for the live turn.
    if (last?.role === 'system' && last.kind === 'error') return next
    return { ...next, transcript: [...next.transcript, {
      id: `turn-error-${String(snapshot.turn)}`, role: 'system', kind: 'error',
      text: `${reason.error.code}: ${reason.error.message}`,
    }] }
  }
  if (reason.kind === 'aborted') {
    return { ...next, transcript: [...next.transcript, {
      id: `turn-aborted-${String(snapshot.turn)}`, role: 'system', kind: 'info', text: 'Turn interrupted.',
    }] }
  }
  return next
}

/**
 * Replace the live assistant stream.
 * @param snapshot - current render state.
 * @param streaming - next live frame, or undefined to clear it.
 * @returns the next snapshot.
 */
export function withStreaming(snapshot: TuiSnapshot, streaming: TuiStreamingView | undefined): TuiSnapshot {
  return { ...snapshot, streaming }
}

/**
 * Replace the pending approval prompt.
 * @param snapshot - current render state.
 * @param permission - head approval, or undefined when none is pending.
 * @returns the next snapshot.
 */
export function withPermission(snapshot: TuiSnapshot, permission: TuiPermissionView | undefined): TuiSnapshot {
  return { ...snapshot, permission }
}

/**
 * Replace the pending question batch.
 * @param snapshot - current render state.
 * @param question - head question batch, or undefined when none is pending.
 * @returns the next snapshot.
 */
export function withQuestion(snapshot: TuiSnapshot, question: TuiQuestionView | undefined): TuiSnapshot {
  return { ...snapshot, question }
}

/**
 * Replace the pending `/resume` session picker.
 * @param snapshot - current render state.
 * @param picker - picker state, or undefined to close it.
 * @returns the next snapshot.
 */
export function withPicker(snapshot: TuiSnapshot, picker: TuiSessionPicker | undefined): TuiSnapshot {
  return { ...snapshot, picker }
}

/**
 * Select the `/resume` rows matching a typed id or title fragment.
 * @param sessions - every resumable Session in newest-first order.
 * @param query - case-insensitive id or title fragment; blank matches everything.
 * @returns the matching rows in input order.
 */
export function filterSessionChoices(
  sessions: readonly TuiSessionChoice[], query: string,
): readonly TuiSessionChoice[] {
  const needle = query.trim().toLowerCase()
  if (needle === '') return sessions
  return sessions.filter(session => session.id.toLowerCase().includes(needle)
    || session.title?.toLowerCase().includes(needle) === true)
}

/**
 * Move the picker highlight within its filtered session list.
 * @param snapshot - current render state.
 * @param delta - signed row offset.
 * @returns the next snapshot with the index clamped to the filtered list.
 */
export function withPickerIndex(snapshot: TuiSnapshot, delta: number): TuiSnapshot {
  const picker = snapshot.picker
  if (picker === undefined) return snapshot
  const length = filterSessionChoices(picker.sessions, picker.query).length
  const index = Math.min(length - 1, Math.max(0, picker.index + delta))
  return { ...snapshot, picker: { ...picker, index } }
}

/**
 * Replace the picker's id or title filter and highlight the first match.
 * @param snapshot - current render state.
 * @param query - next case-insensitive id or title fragment.
 * @returns the next snapshot; unchanged when no picker is open.
 */
export function withPickerQuery(snapshot: TuiSnapshot, query: string): TuiSnapshot {
  const picker = snapshot.picker
  if (picker === undefined) return snapshot
  return { ...snapshot, picker: { ...picker, query, index: 0 } }
}

/**
 * Append streamed output to one pending tool block.
 * @param snapshot - current render state.
 * @param callId - exact tool call receiving the text.
 * @param text - new output text.
 * @param maxChars - retained suffix length per tool block; zero retains nothing.
 * @returns the next snapshot, or the input snapshot when no pending block matches.
 */
export function withToolOutput(
  snapshot: TuiSnapshot, callId: string, text: string, maxChars: number,
): TuiSnapshot {
  if (text === '') return snapshot
  const index = snapshot.transcript.findIndex(message => message.role === 'assistant'
    && message.blocks.some(block => block.type === 'tool' && block.callId === callId && block.status === 'pending'))
  const message = snapshot.transcript[index]
  if (message?.role !== 'assistant') return snapshot
  const blocks = message.blocks.map((block): TuiAssistantBlock => {
    if (block.type !== 'tool' || block.callId !== callId || block.status !== 'pending') return block
    const output = `${block.output ?? ''}${text}`
    return { ...block, output: maxChars <= 0 ? '' : output.slice(-maxChars) }
  })
  const transcript = [...snapshot.transcript]
  transcript[index] = { ...message, blocks }
  return { ...snapshot, transcript }
}

/**
 * Update the lifecycle status without touching transcript content.
 * @param snapshot - current render state.
 * @param status - next lifecycle status.
 * @returns the next snapshot.
 */
export function withStatus(snapshot: TuiSnapshot, status: TuiSnapshot['status']): TuiSnapshot {
  return { ...snapshot, status }
}

/**
 * Update the active model route and reasoning effort.
 * @param snapshot - current render state.
 * @param provider - active provider route.
 * @param model - active model id.
 * @param reasoningEffort - selected effort, or undefined for the provider default.
 * @returns the next snapshot.
 */
export function withRoute(
  snapshot: TuiSnapshot, provider: string, model: string, reasoningEffort?: string,
): TuiSnapshot {
  return { ...snapshot, provider, model, reasoningEffort }
}

/**
 * Update the resolved context window of the active route.
 * @param snapshot - current render state.
 * @param contextWindow - reported window, or undefined when the route advertises none.
 * @returns the next snapshot.
 */
export function withContextWindow(snapshot: TuiSnapshot, contextWindow: number | undefined): TuiSnapshot {
  return { ...snapshot, contextWindow }
}

/**
 * Replace the two-step model picker.
 * @param snapshot - current render state.
 * @param modelPicker - picker state, or undefined to close it.
 * @returns the next snapshot.
 */
export function withModelPicker(snapshot: TuiSnapshot, modelPicker: TuiModelPicker | undefined): TuiSnapshot {
  return { ...snapshot, modelPicker }
}

/**
 * Move the model picker highlight within its current step.
 * @param snapshot - current render state.
 * @param delta - signed row offset.
 * @returns the next snapshot with the index clamped to the step's list.
 */
export function withModelPickerIndex(snapshot: TuiSnapshot, delta: number): TuiSnapshot {
  const picker = snapshot.modelPicker
  if (picker === undefined) return snapshot
  const length = picker.step === 'model' ? picker.models.length : picker.efforts.length
  const index = Math.min(length - 1, Math.max(0, picker.index + delta))
  return { ...snapshot, modelPicker: { ...picker, index } }
}

/**
 * Select or deselect one option on the active question.
 * @param snapshot - current render state.
 * @param label - option label to toggle.
 * @returns the next snapshot; unchanged when no question is active.
 */
export function withQuestionOption(snapshot: TuiSnapshot, label: string): TuiSnapshot {
  const question = snapshot.question
  if (question === undefined) return snapshot
  const item = question.questions[question.active]
  if (item === undefined) return snapshot
  const selected = question.selected[item.id] ?? []
  const nextSelected = item.multiSelect === true
    ? selected.includes(label) ? selected.filter(value => value !== label) : [...selected, label]
    : [label]
  return {
    ...snapshot,
    question: { ...question, selected: { ...question.selected, [item.id]: nextSelected } },
  }
}

/**
 * Replace the active question's free-text answer.
 * @param snapshot - current render state.
 * @param text - complete custom answer.
 * @returns the next snapshot; unchanged when no question is active.
 */
export function withQuestionCustom(snapshot: TuiSnapshot, text: string): TuiSnapshot {
  const question = snapshot.question
  if (question === undefined) return snapshot
  const item = question.questions[question.active]
  if (item === undefined) return snapshot
  return {
    ...snapshot,
    question: { ...question, custom: { ...question.custom, [item.id]: text } },
  }
}

/**
 * Move the question cursor within the batch.
 * @param snapshot - current render state.
 * @param delta - signed question offset.
 * @returns the next snapshot with the cursor clamped to the batch.
 */
export function withQuestionStep(snapshot: TuiSnapshot, delta: number): TuiSnapshot {
  const question = snapshot.question
  if (question === undefined) return snapshot
  const active = Math.min(question.questions.length - 1, Math.max(0, question.active + delta))
  return { ...snapshot, question: { ...question, active } }
}

/**
 * Reset the transcript for a newly selected Session.
 * @param snapshot - current render state.
 * @param sessionId - new Session identity.
 * @param cwd - Session execution directory.
 * @param provider - active provider route.
 * @param model - active model id.
 * @returns the next snapshot with an empty transcript.
 */
export function withSession(
  snapshot: TuiSnapshot, sessionId: string, cwd: string, provider: string, model: string,
): TuiSnapshot {
  return {
    ...snapshot,
    sessionId,
    cwd,
    provider,
    model,
    status: 'idle',
    transcript: [],
    streaming: undefined,
    permission: undefined,
    question: undefined,
    picker: undefined,
    modelPicker: undefined,
    contextWindow: undefined,
    contextTokens: 0,
    reasoningEffort: undefined,
    tokens: EMPTY_TOKENS,
    turn: 0,
  }
}

/**
 * Drop every rendered transcript entry without touching Session history.
 * @param snapshot - current render state.
 * @returns the next snapshot with an empty transcript.
 */
export function withClearedTranscript(snapshot: TuiSnapshot): TuiSnapshot {
  return { ...snapshot, transcript: [], streaming: undefined }
}

/**
 * Mark the surface stopped before teardown.
 * @param snapshot - current render state.
 * @returns the next snapshot with prompts and the live stream cleared.
 */
export function withStopped(snapshot: TuiSnapshot): TuiSnapshot {
  return { ...snapshot, status: 'stopped', streaming: undefined, permission: undefined, question: undefined, picker: undefined, modelPicker: undefined }
}
