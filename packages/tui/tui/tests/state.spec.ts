import { describe, expect, it } from 'vitest'
import { createAssistantMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionSeq, type SessionEvent } from '@deepseek-ai/dsh-session'
import {
  filterSessionChoices,
  initialSnapshot, resultDiffs, toolResultText, userMessageText, withAssistantMessage, withClearedTranscript,
  withContextWindow, withModelPicker, withModelPickerIndex, withPermission, withPicker, withPickerIndex, withPickerQuery,
  withQuestion,
  withQuestionCustom, withQuestionOption, withQuestionStep,
  withRoute, withSession,
  withStatus, withStopped, withStreaming, withSystemNotice, withToolOutput, withToolResult, withTurnEnd, withTurnStart, withUserMessage,
} from '../src/state/state.ts'

const callId = ToolCallId('call-1')

function assistantEvent(): SessionEvent<'assistant/message'> {
  return {
    type: 'assistant/message',
    seq: SessionSeq(3),
    time: 1,
    surfaceOp: 'append',
    data: {
      turn: 1,
      step: 1,
      message: createAssistantMessage({
        content: [
          { type: 'text', text: 'checking' },
          { type: 'tool-call', id: callId, name: 'bash', arguments: '{"command":"ls"}' },
        ],
        source: { provider: 'mock', model: 'mock' },
      }),
      stream: [],
      usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 },
    },
  }
}

function base() {
  return initialSnapshot({ sessionId: 'session-1', cwd: '/tmp', provider: 'mock', model: 'mock' })
}

describe('transcript state', () => {
  it('bounds retained notices', () => {
    let state = base()
    state = withSystemNotice(state, 'info', 'one', 2)
    state = withSystemNotice(state, 'info', 'two', 2)
    state = withSystemNotice(state, 'info', 'three', 2)
    expect(state.transcript.map(message => message.role === 'system' ? message.text : '')).toEqual(['two', 'three'])
  })

  it('appends a user message and ignores empty text', () => {
    expect(withUserMessage(base(), 'u', 'hello', 10).transcript).toEqual([{ id: 'u', role: 'user', text: 'hello' }])
    expect(withUserMessage(base(), 'u', '   ', 10).transcript).toEqual([])
  })

  it('folds an assistant message, usage, and the live stream', () => {
    const streaming = withStreaming(base(), { turn: 1, step: 1, text: 'partial', reasoning: '' })
    const state = withAssistantMessage(streaming, assistantEvent(), 10)
    expect(state.streaming).toBeUndefined()
    expect(state.tokens).toEqual({
      input: 10, output: 2, cacheRead: 0, cacheWrite: 0, reasoning: 0, total: 12,
    })
    const message = state.transcript[0]
    expect(message?.role).toBe('assistant')
    if (message?.role !== 'assistant') throw new Error('expected an assistant message')
    expect(message.blocks[0]).toEqual({ type: 'text', text: 'checking' })
    expect(message.blocks[1]).toMatchObject({ type: 'tool', callId: 'call-1', status: 'pending' })
  })

  it('appends streamed output to a pending tool block only', () => {
    const state = withAssistantMessage(base(), assistantEvent(), 10)
    const streamed = withToolOutput(state, 'call-1', 'one\ntwo', 100)
    const message = streamed.transcript[0]
    if (message?.role !== 'assistant') throw new Error('expected an assistant message')
    expect(message.blocks[1]).toMatchObject({ type: 'tool', status: 'pending', output: 'one\ntwo' })
    expect(withToolOutput(streamed, 'call-1', '', 100)).toBe(streamed)
    expect(withToolOutput(streamed, 'call-2', 'x', 100)).toBe(streamed)
    expect(withToolOutput(streamed, 'call-1', 'three', 5)).toMatchObject({
      transcript: [{ blocks: [{}, { output: 'three' }] }],
    })
    expect(withToolOutput(streamed, 'call-1', 'hidden', 0)).toMatchObject({
      transcript: [{ blocks: [{}, { output: '' }] }],
    })
    const completed = withToolResult(streamed, 'call-1', { output: 'final', isError: false })
    expect(withToolOutput(completed, 'call-1', 'late', 100)).toBe(completed)
  })

  it('attaches a successful result with diffs', () => {
    const state = withToolResult(withAssistantMessage(base(), assistantEvent(), 10), 'call-1', {
      output: 'ok',
      isError: false,
      diffs: [{ path: 'a.txt', oldText: 'old', newText: 'new' }],
    })
    const message = state.transcript[0]
    if (message?.role !== 'assistant') throw new Error('expected an assistant message')
    expect(message.blocks[1]).toMatchObject({
      type: 'tool',
      status: 'success',
      output: 'ok',
      diffs: [{ path: 'a.txt', oldText: 'old', newText: 'new' }],
    })
  })

  it('marks an aborted tool call cancelled', () => {
    const state = withToolResult(withAssistantMessage(base(), assistantEvent(), 10), 'call-1', {
      output: '',
      isError: true,
      code: 'ABORTED',
      reason: 'stopped',
    })
    const message = state.transcript[0]
    if (message?.role !== 'assistant') throw new Error('expected an assistant message')
    expect(message.blocks[1]).toMatchObject({ type: 'tool', status: 'cancelled', error: 'stopped' })
  })

  it('ignores a result that pairs with no rendered call', () => {
    const state = withAssistantMessage(base(), assistantEvent(), 10)
    expect(withToolResult(state, 'missing', { output: 'x', isError: false })).toBe(state)
  })
})

describe('turn closure', () => {
  it('renders an error reason', () => {
    const state = withTurnEnd(base(), { kind: 'error', error: { message: 'boom', code: 'X' } })
    expect(state.status).toBe('idle')
    expect(state.transcript.at(-1)).toMatchObject({ role: 'system', kind: 'error', text: 'X: boom' })
  })

  it('renders an interrupted turn', () => {
    const state = withTurnEnd(base(), { kind: 'aborted', reason: { kind: 'user' } })
    expect(state.transcript.at(-1)).toMatchObject({ role: 'system', kind: 'info', text: 'Turn interrupted.' })
  })

  it('closes a completed turn without a notice', () => {
    expect(withTurnEnd(base(), { kind: 'completed' }).transcript).toEqual([])
  })
})

describe('result metadata', () => {
  it('accepts only well-formed diff arrays', () => {
    expect(resultDiffs({ diffs: [{ path: 'a', oldText: null, newText: 'b' }] }))
      .toEqual([{ path: 'a', oldText: null, newText: 'b' }])
    expect(resultDiffs({ diffs: [{ path: 'a', oldText: 1, newText: 'b' }] })).toBeUndefined()
    expect(resultDiffs({ diffs: [] })).toBeUndefined()
    expect(resultDiffs(undefined)).toBeUndefined()
  })
})

describe('question state', () => {
  const question = {
    id: 'q',
    questions: [{
      id: 'a',
      question: 'Pick',
      options: [{ label: 'one' }, { label: 'two' }],
      multiSelect: true,
    }],
    selected: {},
    custom: {},
    active: 0,
  }

  it('toggles multi-select options', () => {
    let state = withQuestion(base(), question)
    state = withQuestionOption(state, 'one')
    state = withQuestionOption(state, 'two')
    expect(state.question?.selected.a).toEqual(['one', 'two'])
    state = withQuestionOption(state, 'one')
    expect(state.question?.selected.a).toEqual(['two'])
  })

  it('replaces the selection for a single-select question', () => {
    let state = withQuestion(base(), {
      ...question,
      questions: [{ id: 'a', question: 'Pick', options: [{ label: 'one' }, { label: 'two' }] }],
    })
    state = withQuestionOption(state, 'one')
    state = withQuestionOption(state, 'two')
    expect(state.question?.selected.a).toEqual(['two'])
  })
})

describe('content extraction', () => {
  it('renders attachment placeholders in user and tool content', () => {
    expect(userMessageText([
      { type: 'text', text: 'hi' },
      { type: 'image', attachment: {} as never },
      { type: 'file', attachment: {} as never },
      { type: 'tool-call', id: callId, name: 'x', arguments: '{}' },
    ])).toBe('hi\n[image]\n[file]')
    expect(toolResultText([
      { type: 'text', text: 'ok' },
      { type: 'image', attachment: {} as never },
      { type: 'file', attachment: {} as never },
    ])).toBe('ok\n[image result]\n[file result]')
  })

  it('drops non-rendering assistant blocks and keeps reasoning', () => {
    const event: SessionEvent<'assistant/message'> = {
      type: 'assistant/message',
      seq: SessionSeq(9),
      time: 3,
      surfaceOp: 'append',
      data: {
        turn: 2,
        step: 1,
        message: createAssistantMessage({
          content: [
            { type: 'reasoning', text: 'why' },
            { type: 'text', text: '' },
            { type: 'image', attachment: {} as never },
            { type: 'file', attachment: {} as never },
            { type: 'tool-addition', toolName: 'a' },
            { type: 'tool-removal', toolName: 'b' },
          ],
          source: { provider: 'mock', model: 'mock' },
        }),
        stream: [],
      },
    }
    const state = withAssistantMessage(base(), event, 10)
    expect(assistantBlocksOf(state)).toEqual([{ type: 'reasoning', text: 'why' }])
  })

  it('does not append a message made only of non-rendering blocks', () => {
    const event: SessionEvent<'assistant/message'> = {
      type: 'assistant/message',
      seq: SessionSeq(10),
      time: 4,
      surfaceOp: 'append',
      data: {
        turn: 2,
        step: 1,
        message: createAssistantMessage({
          content: [{ type: 'image', attachment: {} as never }],
          source: { provider: 'mock', model: 'mock' },
        }),
        stream: [],
      },
    }
    const state = withAssistantMessage(base(), event, 10)
    expect(state.transcript).toEqual([])
  })

  it('keeps a stream that belongs to another step', () => {
    const streaming = withStreaming(base(), { turn: 2, step: 2, text: 'later', reasoning: '' })
    const state = withAssistantMessage(streaming, assistantEvent(), 10)
    expect(state.streaming).toEqual({ turn: 2, step: 2, text: 'later', reasoning: '' })
  })
})

function assistantBlocksOf(snapshot: ReturnType<typeof base>) {
  const message = snapshot.transcript[0]
  if (message?.role !== 'assistant') throw new Error('expected an assistant message')
  return message.blocks
}

describe('tool failures and diff validation', () => {
  it('marks a non-abort failure as an error', () => {
    const state = withToolResult(withAssistantMessage(base(), assistantEvent(), 10), 'call-1', {
      output: '',
      isError: true,
      code: 'FAILED',
    })
    expect(assistantBlocksOf(state)[1]).toMatchObject({ type: 'tool', status: 'error' })
  })

  it('rejects malformed diff members and metadata', () => {
    expect(resultDiffs('not a record')).toBeUndefined()
    expect(resultDiffs({ diffs: 'nope' })).toBeUndefined()
    expect(resultDiffs({ diffs: [{ path: 1, oldText: null, newText: 'x' }] })).toBeUndefined()
    expect(resultDiffs({ diffs: [{ path: 'a', oldText: 1, newText: 'x' }] })).toBeUndefined()
    expect(resultDiffs({ diffs: [{ path: 'a', oldText: null, newText: 1 }] })).toBeUndefined()
    expect(resultDiffs({ diffs: [null] })).toBeUndefined()
  })
})

describe('turn and prompt transitions', () => {
  it('does not repeat an error already rendered by agent/error', () => {
    const state = withTurnEnd(withSystemNotice(base(), 'error', 'boom', 10), {
      kind: 'error', error: { message: 'boom', code: 'X' },
    })
    expect(state.transcript).toHaveLength(1)
  })

  it('sets and clears prompt, route, status, and streaming state', () => {
    let state = withTurnStart(base(), 4)
    expect(state).toMatchObject({ turn: 4, status: 'running' })
    state = withPermission(state, { id: 'p', toolName: 'bash' })
    state = withQuestion(state, {
      id: 'q', questions: [{ id: 'a', question: 'Pick' }], selected: {}, custom: {}, active: 0,
    })
    state = withRoute(state, 'p', 'm')
    state = withStatus(state, 'idle')
    state = withStreaming(state, { turn: 4, step: 1, text: 't', reasoning: 'r' })
    expect(state).toMatchObject({
      provider: 'p', model: 'm', status: 'idle', permission: { id: 'p' }, question: { id: 'q' },
      streaming: { text: 't' },
    })
    expect(withPermission(state, undefined).permission).toBeUndefined()
    expect(withQuestion(state, undefined).question).toBeUndefined()
    expect(withStreaming(state, undefined).streaming).toBeUndefined()
  })

  it('ignores question edits with no active question or item', () => {
    const emptySnapshot = base()
    expect(withQuestionOption(emptySnapshot, 'a')).toBe(emptySnapshot)
    expect(withQuestionCustom(emptySnapshot, 'a')).toBe(emptySnapshot)
    expect(withQuestionStep(emptySnapshot, 1)).toBe(emptySnapshot)
    const empty = withQuestion(base(), { id: 'q', questions: [], selected: {}, custom: {}, active: 0 })
    expect(withQuestionOption(empty, 'a')).toBe(empty)
    expect(withQuestionCustom(empty, 'a')).toBe(empty)
    expect(withQuestionStep(empty, 1).question?.active).toBe(-1)
  })

  it('edits custom text and moves the question cursor', () => {
    let state = withQuestion(base(), {
      id: 'q',
      questions: [{ id: 'a', question: 'A' }, { id: 'b', question: 'B' }],
      selected: {},
      custom: {},
      active: 0,
    })
    state = withQuestionCustom(state, 'first')
    expect(state.question?.custom.a).toBe('first')
    state = withQuestionStep(state, 1)
    expect(state.question?.active).toBe(1)
    state = withQuestionStep(state, 5)
    expect(state.question?.active).toBe(1)
    state = withQuestionStep(state, -5)
    expect(state.question?.active).toBe(0)
  })

  it('resets and clears transcripts', () => {
    const populated = withUserMessage(base(), 'u', 'hello', 10)
    const session = withSession(populated, 'session-2', '/work', 'p', 'm')
    expect(session).toMatchObject({
      sessionId: 'session-2', cwd: '/work', provider: 'p', model: 'm', status: 'idle', transcript: [], turn: 0,
    })
    expect(withClearedTranscript(populated)).toMatchObject({ transcript: [], streaming: undefined })
    expect(withStopped(withPermission(populated, { id: 'p', toolName: 'bash' }))).toMatchObject({
      status: 'stopped', streaming: undefined, permission: undefined, question: undefined,
    })
  })
})

describe('remaining content branches', () => {
  it('drops empty reasoning and non-text tool results', () => {
    expect(toolResultText([
      { type: 'text', text: 'ok' },
      { type: 'tool-call', id: callId, name: 'x', arguments: '{}' },
    ])).toBe('ok')
    const emptyReasoning: SessionEvent<'assistant/message'> = {
      type: 'assistant/message',
      seq: SessionSeq(11),
      time: 5,
      surfaceOp: 'append',
      data: {
        turn: 2,
        step: 1,
        message: createAssistantMessage({
          content: [{ type: 'reasoning', text: '' }, { type: 'text', text: 'visible' }],
          source: { provider: 'mock', model: 'mock' },
        }),
        stream: [],
      },
    }
    expect(assistantBlocksOf(withAssistantMessage(base(), emptyReasoning, 10)))
      .toEqual([{ type: 'text', text: 'visible' }])
  })
})

describe('resume picker state', () => {
  const picker = {
    sessions: [
      { id: 'a', title: 'Fix the parser', createdAt: 1, cwd: '/work', live: false },
      { id: 'b', createdAt: 2, cwd: '/work', live: true },
    ],
    query: '',
    index: 0,
  }

  it('opens, moves within, and closes the picker', () => {
    const opened = withPicker(base(), picker)
    expect(opened.picker).toEqual(picker)
    expect(withPickerIndex(opened, 1).picker?.index).toBe(1)
    expect(withPickerIndex(opened, 9).picker?.index).toBe(1)
    expect(withPickerIndex(opened, -9).picker?.index).toBe(0)
    expect(withPicker(opened, undefined).picker).toBeUndefined()
  })

  it('filters by id or title and clamps movement to the matches', () => {
    expect(filterSessionChoices(picker.sessions, '')).toEqual(picker.sessions)
    expect(filterSessionChoices(picker.sessions, 'PARSER').map(session => session.id)).toEqual(['a'])
    expect(filterSessionChoices(picker.sessions, ' b ').map(session => session.id)).toEqual(['b'])
    expect(filterSessionChoices(picker.sessions, 'missing')).toEqual([])

    const opened = withPicker(base(), { ...picker, index: 1 })
    const filtered = withPickerQuery(opened, 'parser')
    expect(filtered.picker).toMatchObject({ query: 'parser', index: 0 })
    expect(withPickerIndex(filtered, 1).picker?.index).toBe(0)
    expect(withPickerQuery(base(), 'x')).toEqual(base())
  })

  it('ignores movement without a picker and clears it on session reset', () => {
    const empty = base()
    expect(withPickerIndex(empty, 1)).toBe(empty)
    const opened = withPicker(empty, picker)
    expect(withSession(opened, 's2', '/work', 'p', 'm').picker).toBeUndefined()
    expect(withStopped(opened).picker).toBeUndefined()
  })
})

describe('context and model picker state', () => {
  it('tracks prompt-plus-output tokens from the latest request', () => {
    const state = withAssistantMessage(base(), assistantEvent(), 10)
    expect(state.contextTokens).toBe(12)
    const noUsage: SessionEvent<'assistant/message'> = {
      type: 'assistant/message',
      seq: SessionSeq(12),
      time: 6,
      surfaceOp: 'append',
      data: {
        turn: 2,
        step: 1,
        message: createAssistantMessage({
          content: [{ type: 'text', text: 'again' }],
          source: { provider: 'mock', model: 'mock' },
        }),
        stream: [],
      },
    }
    expect(withAssistantMessage(state, noUsage, 10).contextTokens).toBe(12)
  })

  it('updates route effort and the context window', () => {
    const state = withContextWindow(withRoute(base(), 'p', 'm', 'high'), 128_000)
    expect(state).toMatchObject({ provider: 'p', model: 'm', reasoningEffort: 'high', contextWindow: 128_000 })
    expect(withRoute(state, 'p', 'm').reasoningEffort).toBeUndefined()
  })

  it('moves the model picker within the model and effort steps', () => {
    const modelPicker = {
      step: 'model' as const,
      models: [
        { provider: 'p', model: 'a', name: 'A' },
        { provider: 'p', model: 'b', name: 'B' },
      ],
      index: 0,
    }
    const opened = withModelPicker(base(), modelPicker)
    expect(withModelPickerIndex(opened, 1).modelPicker).toMatchObject({ index: 1 })
    expect(withModelPickerIndex(opened, 9).modelPicker).toMatchObject({ index: 1 })
    expect(withModelPickerIndex(opened, -9).modelPicker).toMatchObject({ index: 0 })
    expect(withModelPicker(opened, undefined).modelPicker).toBeUndefined()
    const effort = withModelPicker(base(), {
      step: 'effort',
      provider: 'p',
      model: 'a',
      name: 'A',
      efforts: [{ id: '', name: 'default' }, { id: 'high', name: 'High' }],
      index: 1,
    })
    expect(withModelPickerIndex(effort, -1).modelPicker).toMatchObject({ index: 0 })
    expect(withModelPickerIndex(effort, 5).modelPicker).toMatchObject({ index: 1 })
  })

  it('ignores picker movement without a picker and clears it on reset', () => {
    const empty = base()
    expect(withModelPickerIndex(empty, 1)).toBe(empty)
    const opened = withModelPicker(empty, { step: 'model', models: [], index: 0 })
    expect(withSession(opened, 's2', '/work', 'p', 'm').modelPicker).toBeUndefined()
    expect(withStopped(opened).modelPicker).toBeUndefined()
    expect(withSession(opened, 's2', '/work', 'p', 'm')).toMatchObject({
      contextWindow: undefined, contextTokens: 0, reasoningEffort: undefined,
    })
  })
})
