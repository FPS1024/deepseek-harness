import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentDefaultModelConfig from '@deepseek-ai/dsh-agent-default-model'
import LocalJobRegistry from '@deepseek-ai/dsh-jobs-local'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import { defineTool } from '@deepseek-ai/dsh-tools'
import ApprovalService from '@deepseek-ai/dsh-user-approval'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import { TuiRuntime } from '../src/runtime.ts'
import type { TuiConfig, TuiIo, TuiSnapshot } from '../src/types.ts'
import { HANG, ScriptedAdapter, textResponse, toolCallResponse, waitFor } from './harness.ts'

const CONFIG: TuiConfig = {
  streamFrameMs: 0,
  toolOutputLines: 6,
  diffContextLines: 1,
  diffMaxLines: 100,
  maxTranscriptMessages: 100,
  historyLimit: 20,
  toolOutputChars: 64_000,
}

const EXIT: TuiIo = {
  stdin: process.stdin,
  stdout: process.stdout,
  stderr: process.stderr,
  exit: () => {},
}

interface Fixture {
  runtime: TuiRuntime
  ctx: Context
  adapter: ScriptedAdapter
}

const contexts: Context[] = []
const runtimes: TuiRuntime[] = []

afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.shutdown()
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
})

async function setup(
  script: ConstructorParameters<typeof ScriptedAdapter>[0],
  register?: (ctx: Context) => void | Promise<void>,
  historyFile: string | null = null,
): Promise<Fixture> {
  const ctx = new Context()
  contexts.push(ctx)
  await mountAgentLoopTestDependencies(ctx)
  const adapter = new ScriptedAdapter(script)
  ctx.llm.registerAdapter(['mock'], adapter)
  await ctx.plugin(AgentDefaultModelConfig, { provider: 'mock', model: 'mock' })
  await ctx.plugin(ApprovalService, { policy: 'ask' })
  await ctx.plugin(UserQuestionService)
  await mountAgentLoopTestHarness(ctx)
  await register?.(ctx)
  const runtime = new TuiRuntime({ ctx, config: CONFIG, io: EXIT, historyFile })
  runtimes.push(runtime)
  await runtime.start()
  return { runtime, ctx, adapter }
}

function assistantBlocks(snapshot: TuiSnapshot) {
  return snapshot.transcript.flatMap(message => message.role === 'assistant' ? message.blocks : [])
}

describe('TuiRuntime', () => {
  it('creates an Agent and folds a streamed answer into the transcript', async () => {
    const { runtime } = await setup([textResponse('hello there')])
    expect(runtime.getSnapshot().status).toBe('idle')
    expect(runtime.getSnapshot().sessionId).toBe('')
    await runtime.submit('count the files')
    expect(runtime.getSnapshot().sessionId).not.toBe('')
    await waitFor(
      () => assistantBlocks(runtime.getSnapshot()).some(block => block.type === 'text'),
      'the assistant answer',
    )
    const snapshot = runtime.getSnapshot()
    expect(snapshot.transcript.filter(message => message.role === 'user')).toHaveLength(1)
    expect(assistantBlocks(snapshot)).toContainEqual({ type: 'text', text: 'hello there' })
    expect(snapshot.tokens.input).toBe(10)
  })

  it('stores no Session until a prompt or agent command needs one', async () => {
    const { runtime } = await setup([textResponse('ok')])
    await runtime.submit('/help')
    await runtime.submit('/status')
    expect(runtime.getSnapshot().sessionId).toBe('')
    await runtime.submit('hello')
    await waitFor(() => runtime.getSnapshot().sessionId !== '', 'the started Session')
  })

  it('/new returns to the unstarted state and starts a different Session on the next prompt', async () => {
    const { runtime } = await setup([textResponse('first'), textResponse('second')])
    await runtime.submit('one')
    await waitFor(() => runtime.getSnapshot().status === 'idle' && runtime.getSnapshot().sessionId !== '', 'the first turn')
    const firstId = runtime.getSnapshot().sessionId
    await runtime.submit('/new')
    expect(runtime.getSnapshot().sessionId).toBe('')
    expect(runtime.getSnapshot().status).toBe('idle')
    await runtime.submit('two')
    await waitFor(
      () => runtime.getSnapshot().sessionId !== '' && runtime.getSnapshot().sessionId !== firstId,
      'the replacement Session',
    )
  })

  it('renders a tool call and its result inside the assistant message', async () => {
    const { runtime } = await setup([toolCallResponse('call-1', 'echo', { value: 'hi' }), textResponse('done')], (ctx) => {
      ctx.tools.register(defineTool({
        name: 'echo',
        description: 'Echo one value.',
        parameters: { value: { type: 'string', required: true } },
        output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
        execute: args => Promise.resolve(args.value),
      }))
    })
    await runtime.submit('use the echo tool')
    await waitFor(
      () => assistantBlocks(runtime.getSnapshot()).some(block => block.type === 'tool' && block.status === 'success'),
      'the tool result',
    )
    const tool = assistantBlocks(runtime.getSnapshot()).find(block => block.type === 'tool')
    expect(tool).toMatchObject({ type: 'tool', name: 'echo', status: 'success', output: 'hi' })
  })

  it('waits for an approval decision before the tool runs', async () => {
    const { runtime } = await setup([toolCallResponse('call-2', 'approval_probe', {}), textResponse('done')], (ctx) => {
      ctx.tools.register(defineTool({
        name: 'approval_probe',
        description: 'Ask for approval.',
        parameters: {},
        output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
        execute: async (_args, exec) => {
          if (exec.agent === undefined) throw new Error('no agent')
          return ctx.approval.request({ agent: exec.agent, toolName: 'approval_probe', reason: 'test approval' })
        },
      }))
    })
    await runtime.submit('ask permission')
    await waitFor(() => runtime.getSnapshot().permission !== undefined, 'the approval prompt')
    expect(runtime.getSnapshot().permission).toMatchObject({ toolName: 'approval_probe', reason: 'test approval' })
    runtime.resolvePermission('allowed-once')
    await waitFor(
      () => assistantBlocks(runtime.getSnapshot()).some(block => block.type === 'tool' && block.status === 'success'),
      'the approved tool result',
    )
    const tool = assistantBlocks(runtime.getSnapshot()).find(block => block.type === 'tool')
    expect(tool).toMatchObject({ output: 'allowed-once' })
  })

  it('shows the pending file diff in an approval', async () => {
    const { runtime } = await setup([
      toolCallResponse('call-diff', 'write_probe', { path: 'note.txt', oldText: 'old\n', newText: 'new\n' }),
      textResponse('done'),
    ], (ctx) => {
      ctx.tools.register(defineTool({
        name: 'write_probe',
        description: 'Write a file.',
        parameters: {
          path: { type: 'string', required: true },
          oldText: { type: 'string', required: true },
          newText: { type: 'string', required: true },
        },
        output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
        presentCall: args => ({
          card: 'diff',
          title: `Write ${args.path}`,
          diffs: [{ path: args.path, oldText: args.oldText, newText: args.newText }],
        }),
        execute: async (_args, exec) => {
          if (exec.agent === undefined) throw new Error('no agent')
          return ctx.approval.request({
            agent: exec.agent,
            toolName: 'write_probe',
            callId: exec.callId,
            reason: 'writes a file',
          })
        },
      }))
    })
    await runtime.submit('write the note')
    await waitFor(() => runtime.getSnapshot().permission !== undefined, 'the approval prompt')
    const permission = runtime.getSnapshot().permission
    expect(permission).toMatchObject({ toolName: 'write_probe', title: 'Write note.txt', reason: 'writes a file' })
    expect(permission?.details).toContainEqual({ kind: 'path', text: 'note.txt' })
    expect(permission?.details).toContainEqual({ kind: 'removed', text: '-    1 old' })
    expect(permission?.details).toContainEqual({ kind: 'added', text: '+    1 new' })
    runtime.resolvePermission('rejected')
  })

  it('shows the pending shell command in an approval', async () => {
    const { runtime } = await setup([
      toolCallResponse('call-command', 'command_probe', { command: 'rm note.txt' }),
      textResponse('done'),
    ], (ctx) => {
      ctx.tools.register(defineTool({
        name: 'command_probe',
        description: 'Run a command.',
        parameters: { command: { type: 'string', required: true } },
        output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
        presentCall: args => ({ card: 'terminal', title: args.command, description: 'Deletes a file', cwd: '/work' }),
        execute: async (_args, exec) => {
          if (exec.agent === undefined) throw new Error('no agent')
          return ctx.approval.request({ agent: exec.agent, toolName: 'command_probe', callId: exec.callId })
        },
      }))
    })
    await runtime.submit('remove the note')
    await waitFor(() => runtime.getSnapshot().permission !== undefined, 'the approval prompt')
    expect(runtime.getSnapshot().permission).toMatchObject({
      toolName: 'command_probe',
      command: 'rm note.txt',
      description: 'Deletes a file',
      cwd: '/work',
    })
    runtime.resolvePermission('rejected')
  })

  it('returns the selected answer to a user-questions request', async () => {
    const { runtime } = await setup([toolCallResponse('call-3', 'question_probe', {}), textResponse('done')], (ctx) => {
      ctx.tools.register(defineTool({
        name: 'question_probe',
        description: 'Ask the user.',
        parameters: {},
        output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
        execute: async (_args, exec) => {
          if (exec.agent === undefined) throw new Error('no agent')
          const answer = await ctx.userQuestions.ask({
            agent: exec.agent,
            questions: [{ id: 'q', question: 'Proceed?', options: [{ label: 'yes' }, { label: 'no' }] }],
          })
          return answer.answers[0]?.selected[0] ?? 'none'
        },
      }))
    })
    await runtime.submit('ask a question')
    await waitFor(() => runtime.getSnapshot().question !== undefined, 'the question prompt')
    runtime.toggleQuestionOption('yes')
    runtime.submitQuestion()
    await waitFor(
      () => assistantBlocks(runtime.getSnapshot()).some(block => block.type === 'tool' && block.status === 'success'),
      'the answered tool result',
    )
    const tool = assistantBlocks(runtime.getSnapshot()).find(block => block.type === 'tool')
    expect(tool).toMatchObject({ output: 'yes' })
  })

  it('streams job output into a pending tool call', async () => {
    const { runtime } = await setup([
      toolCallResponse('call-stream', 'stream_probe', {}),
      textResponse('done'),
    ], async (ctx) => {
      await ctx.plugin(LocalJobRegistry)
      ctx.jobs.attachController('tui-test')
      ctx.tools.register(defineTool({
        name: 'stream_probe',
        description: 'Stream output.',
        parameters: {},
        output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
        execute: async (_args, exec) => {
          if (exec.agent === undefined) throw new Error('no agent')
          const owner = exec.agent.session.id
          let finish: (() => void) | undefined
          const completed = new Promise<void>((resolve) => { finish = resolve })
          const id = ctx.jobs.start({
            kind: 'bash',
            label: 'stream probe',
            owner,
            toolCall: { callId: exec.callId, rootCallId: exec.rootCallId },
            run: (job) => {
              job.append('first line\n')
              const timer = setTimeout(() => { job.append('second line\n'); finish?.() }, 20)
              return {
                cancel: () => { clearTimeout(timer); finish?.() },
                done: completed.then(() => ({ status: 'completed' as const })),
              }
            },
          })
          await ctx.jobs.wait(id, 5_000, owner)
          return ctx.jobs.read(id, owner).chunks.map(chunk => chunk.text).join('')
        },
      }))
    })
    const streamed: string[] = []
    const unsubscribe = runtime.subscribe(() => {
      for (const block of assistantBlocks(runtime.getSnapshot())) {
        if (block.type === 'tool' && block.status === 'pending' && block.output !== undefined) {
          streamed.push(block.output)
        }
      }
    })
    await runtime.submit('stream something')
    try {
      await waitFor(
        () => streamed.some(output => output.includes('first line')),
        'the streamed tool output',
      )
    } finally {
      unsubscribe()
    }
    await waitFor(
      () => assistantBlocks(runtime.getSnapshot()).some(block => block.type === 'tool' && block.status === 'success'),
      'the tool result',
    )
    const tool = assistantBlocks(runtime.getSnapshot()).find(block => block.type === 'tool')
    expect(tool).toMatchObject({ status: 'success', output: 'first line\nsecond line\n' })
  })

  it('persists composer history across runtimes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-tui-history-'))
    const file = join(directory, 'history.json')
    try {
      const first = await setup([], undefined, file)
      first.runtime.remember('hello')
      first.runtime.remember('hello')
      first.runtime.remember('world')
      await first.runtime.shutdown()
      const second = await setup([], undefined, file)
      expect(second.runtime.history()).toEqual(['hello', 'world'])
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('stops a running turn and reports the interruption', async () => {
    const { runtime } = await setup([HANG])
    await runtime.submit('wait forever')
    await waitFor(() => runtime.getSnapshot().status === 'running', 'the running turn')
    runtime.interrupt()
    await waitFor(() => runtime.getSnapshot().status === 'idle', 'the interrupted turn')
    expect(runtime.getSnapshot().transcript).toContainEqual(expect.objectContaining({
      role: 'system', kind: 'info', text: 'Turn interrupted.',
    }))
  })
})

describe('TuiRuntime model picker', () => {
  it('selects a model and its reasoning effort in two steps', async () => {
    const { runtime } = await setup([textResponse('ok')])
    await waitFor(() => runtime.getSnapshot().contextWindow === 1_024, 'the resolved context window')
    await runtime.openModelPicker()
    expect(runtime.getSnapshot().modelPicker).toMatchObject({ step: 'model', index: 0 })
    runtime.moveModelPicker(1)
    await runtime.confirmModelPicker()
    expect(runtime.getSnapshot().modelPicker).toMatchObject({
      step: 'effort', provider: 'mock', model: 'reasoner',
    })
    runtime.moveModelPicker(2)
    await runtime.confirmModelPicker()
    await waitFor(() => runtime.getSnapshot().contextWindow === 64_000, 'the new context window')
    expect(runtime.getSnapshot()).toMatchObject({
      provider: 'mock', model: 'reasoner', reasoningEffort: 'medium',
    })
    expect(runtime.getSnapshot().modelPicker).toBeUndefined()
  })

  it('applies a model without advertised reasoning efforts immediately', async () => {
    const { runtime } = await setup([textResponse('ok')])
    await runtime.openModelPicker()
    runtime.moveModelPicker(-1)
    await runtime.confirmModelPicker()
    await waitFor(() => runtime.getSnapshot().contextWindow === 1_024, 'the context window')
    expect(runtime.getSnapshot()).toMatchObject({ model: 'mock', reasoningEffort: undefined })
  })
})
