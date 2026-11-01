import { createElement } from 'react'
import { render } from 'ink-testing-library'
import { describe, expect, it, vi } from 'vitest'
import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import { App } from '../src/components/App.tsx'
import { initialSnapshot } from '../src/state/state.ts'
import type { TuiCommandInfo, TuiConfig, TuiController, TuiSnapshot } from '../src/types.ts'

const CONFIG: TuiConfig = {
  streamFrameMs: 0,
  toolOutputLines: 4,
  diffContextLines: 1,
  diffMaxLines: 100,
  maxTranscriptMessages: 20,
  historyLimit: 20,
  toolOutputChars: 64_000,
}

class Controller implements TuiController {
  snapshot: TuiSnapshot = initialSnapshot({
    sessionId: 'session-1', cwd: '/tmp', provider: 'mock', model: 'mock',
  })
  readonly submitted: string[] = []
  readonly remembered: string[] = []
  historyEntries: readonly string[] = []
  readonly outcomes: ApprovalOutcome[] = []
  readonly toggled: string[] = []
  readonly custom: string[] = []
  readonly steps: number[] = []
  interrupted = 0
  submittedQuestions = 0
  pickerOpened = 0
  readonly pickerMoves: number[] = []
  pickerClosed = 0
  pickerConfirmed = 0
  readonly pickerQueries: string[] = []
  modelPickerOpened = 0
  readonly modelPickerMoves: number[] = []
  modelPickerClosed = 0
  modelPickerConfirmed = 0
  private readonly listeners = new Set<() => void>()

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  getSnapshot = (): TuiSnapshot => this.snapshot

  history(): readonly string[] { return this.historyEntries }

  remember(text: string): void {
    this.remembered.push(text)
    this.historyEntries = [...this.historyEntries, text]
  }

  commandCatalog(): readonly TuiCommandInfo[] {
    return [
      { name: 'exit', description: 'Exit the terminal.' },
      { name: 'help', description: 'Show terminal commands.' },
      { name: 'resume', description: 'Choose a stored Session to resume.', hint: '[session-id]' },
    ]
  }

  async openSessionPicker(): Promise<void> { this.pickerOpened++ }

  async openModelPicker(): Promise<void> { this.modelPickerOpened++ }

  moveModelPicker(delta: number): void { this.modelPickerMoves.push(delta) }

  async confirmModelPicker(): Promise<void> { this.modelPickerConfirmed++ }

  closeModelPicker(): void { this.modelPickerClosed++ }

  movePicker(delta: number): void { this.pickerMoves.push(delta) }

  setPickerQuery(query: string): void {
    this.pickerQueries.push(query)
    const picker = this.snapshot.picker
    if (picker !== undefined) this.set({ ...this.snapshot, picker: { ...picker, query, index: 0 } })
  }

  closePicker(): void { this.pickerClosed++ }

  confirmPicker(): void { this.pickerConfirmed++ }

  async submit(text: string): Promise<void> { this.submitted.push(text) }

  interrupt(): void { this.interrupted++ }

  resolvePermission(outcome: ApprovalOutcome): void { this.outcomes.push(outcome) }

  toggleQuestionOption(label: string): void { this.toggled.push(label) }

  setQuestionCustom(text: string): void { this.custom.push(text) }

  stepQuestion(delta: number): void { this.steps.push(delta) }

  submitQuestion(): void { this.submittedQuestions++ }

  set(next: TuiSnapshot): void {
    this.snapshot = next
    for (const listener of [...this.listeners]) listener()
  }
}

function tick(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 20))
}

async function submitText(view: ReturnType<typeof render>, text: string): Promise<void> {
  view.stdin.write(text)
  await tick()
  view.stdin.write('\r')
  await tick()
}

describe('App', () => {
  it('submits composer text with Enter', async () => {
    const controller = new Controller()
    const view = render(createElement(App, { runtime: controller, config: CONFIG, onExit: () => {} }))
    await tick()
    view.stdin.write('hello')
    await tick()
    expect(view.lastFrame()).toContain('hello')
    view.stdin.write('\r')
    await tick()
    expect(controller.submitted).toEqual(['hello'])
    view.unmount()
  })

  it('routes Ctrl+C to interrupt and Ctrl+D to exit', async () => {
    const controller = new Controller()
    const onExit = vi.fn()
    const view = render(createElement(App, { runtime: controller, config: CONFIG, onExit }))
    await tick()
    view.stdin.write('\x03')
    await tick()
    expect(controller.interrupted).toBe(1)
    view.stdin.write('\x04')
    await tick()
    expect(onExit).toHaveBeenCalledOnce()
    view.unmount()
  })

  it('answers an approval with y and n', async () => {
    const controller = new Controller()
    const view = render(createElement(App, { runtime: controller, config: CONFIG, onExit: () => {} }))
    await tick()
    controller.set({
      ...controller.snapshot,
      permission: {
        id: 'p',
        toolName: 'bash',
        reason: 'writes a file',
        command: 'rm note.txt',
        details: [{ kind: 'path', text: 'note.txt' }, { kind: 'added', text: '+    1 new' }],
      },
    })
    await tick()
    expect(view.lastFrame()).toContain('Permission required')
    expect(view.lastFrame()).toContain('bash')
    expect(view.lastFrame()).toContain('rm note.txt')
    expect(view.lastFrame()).toContain('note.txt')
    expect(view.lastFrame()).toContain('+    1 new')
    view.stdin.write('n')
    await tick()
    expect(controller.outcomes).toEqual(['rejected'])
    view.unmount()
  })

  it('selects and submits a question option', async () => {
    const controller = new Controller()
    const view = render(createElement(App, { runtime: controller, config: CONFIG, onExit: () => {} }))
    await tick()
    controller.set({
      ...controller.snapshot,
      question: {
        id: 'q',
        questions: [{ id: 'a', question: 'Pick one', options: [{ label: 'one' }, { label: 'two' }] }],
        selected: {},
        custom: {},
        active: 0,
      },
    })
    await tick()
    expect(view.lastFrame()).toContain('Pick one')
    view.stdin.write('2')
    await tick()
    expect(controller.toggled).toEqual(['two'])
    view.stdin.write('\r')
    await tick()
    expect(controller.submittedQuestions).toBe(1)
    view.unmount()
  })

  it('renders a tool result card and a reasoning summary', async () => {
    const controller = new Controller()
    const view = render(createElement(App, { runtime: controller, config: CONFIG, onExit: () => {} }))
    await tick()
    controller.set({
      ...controller.snapshot,
      transcript: [{
        id: 'a',
        role: 'assistant',
        blocks: [
          { type: 'reasoning', text: 'thinking hard' },
          { type: 'tool', callId: 'c', name: 'bash', input: '{"command":"ls"}', status: 'success', output: 'a.txt' },
        ],
      }],
    })
    await tick()
    expect(view.lastFrame()).toContain('thinking (13 chars)')
    expect(view.lastFrame()).toContain('bash')
    expect(view.lastFrame()).toContain('a.txt')
    view.unmount()
  })
})

describe('App command prediction', () => {
  it('shows command explanations and completes with Tab', async () => {
    const controller = new Controller()
    const view = render(createElement(App, { runtime: controller, config: CONFIG, onExit: () => {} }))
    await tick()
    view.stdin.write('/re')
    await tick()
    expect(view.lastFrame()).toContain('Choose a stored Session to resume.')
    view.stdin.write('\t')
    await tick()
    view.stdin.write('\r')
    await tick()
    expect(controller.submitted).toEqual(['/resume'])
    view.unmount()
  })

  it('completes a unique prefix on Enter before submitting', async () => {
    const controller = new Controller()
    const view = render(createElement(App, { runtime: controller, config: CONFIG, onExit: () => {} }))
    await tick()
    view.stdin.write('/he')
    await tick()
    view.stdin.write('\r')
    await tick()
    expect(controller.submitted).toEqual([])
    view.stdin.write('\r')
    await tick()
    expect(controller.submitted).toEqual(['/help'])
    view.unmount()
  })

  it('moves through predictions with the arrow keys', async () => {
    const controller = new Controller()
    const view = render(createElement(App, { runtime: controller, config: CONFIG, onExit: () => {} }))
    await tick()
    view.stdin.write('/')
    await tick()
    view.stdin.write('\u001B[B')
    await tick()
    view.stdin.write('\t')
    await tick()
    view.stdin.write('\r')
    await tick()
    expect(controller.submitted).toEqual(['/help'])
    view.unmount()
  })

  it('does not insert mouse reports into the draft', async () => {
    const controller = new Controller()
    const view = render(createElement(App, { runtime: controller, config: CONFIG, onExit: () => {} }))
    await tick()
    view.stdin.write('\u001B[<64;1;1M')
    view.stdin.write('x')
    await tick()
    view.stdin.write('\r')
    await tick()
    expect(controller.submitted).toEqual(['x'])
    view.unmount()
  })
})

describe('App input history', () => {
  it('recalls previous submissions with Up and restores the draft with Down', async () => {
    const controller = new Controller()
    const view = render(createElement(App, { runtime: controller, config: CONFIG, onExit: () => {} }))
    await tick()
    await submitText(view, 'one')
    await submitText(view, 'two')
    view.stdin.write('\u001B[A')
    await tick()
    view.stdin.write('\r')
    await tick()
    expect(controller.submitted).toEqual(['one', 'two', 'two'])
    view.stdin.write('\u001B[A')
    await tick()
    view.stdin.write('\u001B[A')
    await tick()
    view.stdin.write('\u001B[A')
    await tick()
    view.stdin.write('\r')
    await tick()
    expect(controller.submitted).toEqual(['one', 'two', 'two', 'one'])
    view.stdin.write('draft')
    await tick()
    view.stdin.write('\u001B[A')
    await tick()
    view.stdin.write('\u001B[B')
    await tick()
    view.stdin.write('\r')
    await tick()
    expect(controller.submitted.at(-1)).toBe('draft')
    view.unmount()
  })
})

describe('App resume picker', () => {
  const picker = {
    sessions: [
      { id: 'session-a', createdAt: 0, cwd: '/tmp', live: false },
      { id: 'session-b', createdAt: 0, cwd: '/tmp', live: true },
    ],
    query: '',
    index: 0,
  }

  it('moves the highlight and confirms with Enter', async () => {
    const controller = new Controller()
    const view = render(createElement(App, { runtime: controller, config: CONFIG, onExit: () => {} }))
    await tick()
    controller.set({ ...controller.snapshot, picker })
    await tick()
    expect(view.lastFrame()).toContain('Resume session')
    view.stdin.write('\u001B[B')
    await tick()
    expect(controller.pickerMoves).toEqual([1])
    view.stdin.write('\r')
    await tick()
    expect(controller.pickerConfirmed).toBe(1)
    view.unmount()
  })

  it('closes with Escape', async () => {
    const controller = new Controller()
    const view = render(createElement(App, { runtime: controller, config: CONFIG, onExit: () => {} }))
    await tick()
    controller.set({ ...controller.snapshot, picker })
    await tick()
    view.stdin.write('\u001B')
    await tick()
    expect(controller.pickerClosed).toBe(1)
    view.unmount()
  })

  it('renders titles and edits the search query', async () => {
    const controller = new Controller()
    const view = render(createElement(App, { runtime: controller, config: CONFIG, onExit: () => {} }))
    await tick()
    controller.set({
      ...controller.snapshot,
      picker: {
        sessions: [
          { id: 'session-a', title: 'Fix the parser', createdAt: 0, cwd: '/tmp', live: false },
        ],
        query: '',
        index: 0,
      },
    })
    await tick()
    expect(view.lastFrame()).toContain('Fix the parser')
    expect(view.lastFrame()).toContain('session-a')
    for (const char of 'par') {
      view.stdin.write(char)
      await tick()
    }
    expect(controller.pickerQueries).toEqual(['p', 'pa', 'par'])
    view.stdin.write('\u007F')
    await tick()
    expect(controller.pickerQueries.at(-1)).toBe('pa')
    view.unmount()
  })

  it('shows an empty state for a query with no matches', async () => {
    const controller = new Controller()
    const view = render(createElement(App, { runtime: controller, config: CONFIG, onExit: () => {} }))
    await tick()
    controller.set({ ...controller.snapshot, picker: { ...picker, query: 'missing' } })
    await tick()
    expect(view.lastFrame()).toContain('No matching Sessions.')
    view.unmount()
  })
})

describe('App command history', () => {
  it('walks command history without reopening predictions', async () => {
    const controller = new Controller()
    const view = render(createElement(App, { runtime: controller, config: CONFIG, onExit: () => {} }))
    await tick()
    await submitText(view, '/help')
    await submitText(view, '/resume')
    view.stdin.write('\u001B[A')
    await tick()
    expect(view.lastFrame()).toContain('/resume')
    expect(view.lastFrame()).not.toContain('Commands')
    view.stdin.write('\u001B[A')
    await tick()
    view.stdin.write('\r')
    await tick()
    expect(controller.submitted).toEqual(['/help', '/resume', '/help'])
    expect(controller.remembered).toEqual(['/help', '/resume', '/help'])
    view.unmount()
  })

  it('seeds the walk with durable entries', async () => {
    const controller = new Controller()
    controller.historyEntries = ['persisted prompt']
    const view = render(createElement(App, { runtime: controller, config: CONFIG, onExit: () => {} }))
    await tick()
    view.stdin.write('\u001B[A')
    await tick()
    expect(view.lastFrame()).toContain('persisted prompt')
    view.unmount()
  })

  it('adopts durable entries that finish loading after mount', async () => {
    const controller = new Controller()
    const view = render(createElement(App, { runtime: controller, config: CONFIG, onExit: () => {} }))
    await tick()
    controller.historyEntries = ['late prompt']
    controller.set({ ...controller.snapshot })
    await tick()
    view.stdin.write('\u001B[A')
    await tick()
    expect(view.lastFrame()).toContain('late prompt')
    view.unmount()
  })
})

describe('App model picker', () => {
  const models = [
    { provider: 'mock', model: 'mock', name: 'Mock' },
    { provider: 'mock', model: 'reasoner', name: 'Mock Reasoner', description: 'Selectable reasoning' },
  ]

  it('renders the model step, moves, and confirms', async () => {
    const controller = new Controller()
    const view = render(createElement(App, { runtime: controller, config: CONFIG, onExit: () => {} }))
    await tick()
    controller.set({ ...controller.snapshot, modelPicker: { step: 'model', models, index: 0 } })
    await tick()
    expect(view.lastFrame()).toContain('Select model')
    expect(view.lastFrame()).toContain('Mock Reasoner')
    view.stdin.write('\u001B[B')
    await tick()
    expect(controller.modelPickerMoves).toEqual([1])
    view.stdin.write('\r')
    await tick()
    expect(controller.modelPickerConfirmed).toBe(1)
    view.unmount()
  })

  it('renders the effort step and closes with Escape', async () => {
    const controller = new Controller()
    const view = render(createElement(App, { runtime: controller, config: CONFIG, onExit: () => {} }))
    await tick()
    controller.set({
      ...controller.snapshot,
      reasoningEffort: 'high',
      modelPicker: {
        step: 'effort',
        provider: 'mock',
        model: 'reasoner',
        name: 'Mock Reasoner',
        efforts: [{ id: '', name: 'default (high)' }, { id: 'low', name: 'Low' }, { id: 'high', name: 'High' }],
        index: 1,
      },
    })
    await tick()
    expect(view.lastFrame()).toContain('Reasoning effort')
    expect(view.lastFrame()).toContain('default (high)')
    view.stdin.write('\u001B')
    await tick()
    expect(controller.modelPickerClosed).toBe(1)
    view.unmount()
  })
})

describe('App home parameters', () => {
  it('shows the model, effort, context usage, and status', async () => {
    const controller = new Controller()
    const view = render(createElement(App, { runtime: controller, config: CONFIG, onExit: () => {} }))
    await tick()
    controller.set({
      ...controller.snapshot,
      provider: 'deepseek-official',
      model: 'deepseek-reasoner',
      reasoningEffort: 'high',
      contextWindow: 128_000,
      contextTokens: 12_800,
    })
    await tick()
    const frame = view.lastFrame()
    expect(frame).toContain('deepseek-official/deepseek-reasoner')
    expect(frame).toContain('high')
    expect(frame).toContain('10%')
    view.unmount()
  })
})

describe('App brand banner', () => {
  it('shows the fish mark and wordmark while the transcript is empty', async () => {
    const controller = new Controller()
    const view = render(createElement(App, { runtime: controller, config: CONFIG, onExit: () => {} }))
    await tick()
    expect(view.lastFrame()).toContain('DEEPSEEK HARNESS')
    expect(view.lastFrame()).toContain('▗████')
    controller.set({
      ...controller.snapshot,
      transcript: [{ id: 'u', role: 'user', text: 'hello' }],
    })
    await tick()
    expect(view.lastFrame()).not.toContain('DEEPSEEK HARNESS')
    view.unmount()
  })
})
