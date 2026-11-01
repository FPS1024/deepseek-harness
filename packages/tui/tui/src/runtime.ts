/**
 * The terminal surface runtime: it owns the live Agent, folds Session and
 * Assistant-stream events into one immutable snapshot, dispatches composer
 * input, and answers approval and question requests. Ink and React are not
 * imported here, so the complete frontend behavior is testable without a
 * terminal.
 * @module @deepseek-ai/dsh-tui/runtime
 */

import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import type {
  Agent, AgentHandle, AgentOptions, AssistantStreamFrame, ModelSelection, ModelSelectionRef,
} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import { brandString } from '@deepseek-ai/dsh-brand'
import type {} from '@deepseek-ai/dsh-cmdline'
import type {} from '@deepseek-ai/dsh-commands'
import type { FileSystem } from '@deepseek-ai/dsh-fs'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { JobId, type JobEvent } from '@deepseek-ai/dsh-jobs'
import { createUserMessage, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { LlmModelInfo, ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionSeq } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionQueryEngine, SessionRecord } from '@deepseek-ai/dsh-session-query'
import type { ToolCallView } from '@deepseek-ai/dsh-tools'
import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import type { AskUserQuestionAnswer, AskUserQuestionItem } from '@deepseek-ai/dsh-user-questions'
import type {} from '@deepseek-ai/dsh-user-questions'
import { assertNever } from '@deepseek-ai/dsh-util-values'
import { LOCAL_COMMAND_INFO, parseSlashCommand, runLocalCommand, type CommandHost } from './commands.ts'
import { computeDiff, diffHunkHeader } from './diff.ts'
import { readHistoryFile, rememberInput, writeHistoryFile } from './history.ts'
import {
  filterSessionChoices, initialSnapshot, resultDiffs, toolResultText, userMessageText,
  withAssistantMessage, withClearedTranscript, withContextWindow, withModelPicker, withModelPickerIndex,
  withPermission, withPicker, withPickerIndex, withPickerQuery, withQuestion,
  withQuestionCustom, withQuestionOption, withQuestionStep, withRoute, withSession, withStatus, withStopped, withStreaming,
  withSystemNotice, withToolOutput, withToolResult, withTurnEnd, withTurnStart, withUserMessage,
} from './state/state.ts'
import { toolErrorText } from './tool-view.ts'
import type {
  TuiCommandInfo, TuiConfig, TuiEffortChoice, TuiFileDiff, TuiIo, TuiModelChoice, TuiPermissionDetail,
  TuiPermissionView, TuiQuestionView, TuiSessionChoice, TuiSnapshot, TuiStreamingView,
} from './types.ts'

/** Construction input for one terminal runtime. */
export interface TuiRuntimeOptions {
  readonly ctx: Context
  readonly config: TuiConfig
  readonly io: TuiIo
  /** Exact stored Session to resume; absent starts a fresh Session. */
  readonly resume?: string | undefined
  /** Initial model override in `model` or `provider/model` form. */
  readonly model?: string | undefined
  /** Terminal-owned shutdown request, supplied once the renderer exists. */
  readonly onExit?: (() => void) | undefined
  /**
   * Durable composer-history file; omission follows `$DSH_HOME/tui/history.json`,
   * and `null` disables persistence for this surface.
   */
  readonly historyFile?: string | null | undefined
}

interface PendingApproval {
  readonly view: TuiPermissionView
  readonly resolve: (outcome: ApprovalOutcome) => void
}

interface PendingQuestion {
  view: TuiQuestionView
  readonly resolve: (answer: AskUserQuestionAnswer) => void
  readonly reject: (error: Error) => void
}

/** Structural view of one approval answerer request. */
interface ApprovalAsk {
  readonly agent: Agent
  readonly toolName: string
  readonly callId?: ToolCallId
  readonly reason?: string
  readonly displayReason?: { readonly en: string; readonly [locale: string]: string }
  readonly signal?: AbortSignal
}

/** Structural view of one user-questions answerer request. */
interface QuestionAsk {
  readonly questions: AskUserQuestionItem[]
  readonly signal?: AbortSignal
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'object' && error !== null) {
    const record = error as Record<string, unknown>
    if (typeof record.message === 'string') {
      const code = typeof record.code === 'string' ? record.code : undefined
      return code === undefined ? record.message : `${code}: ${record.message}`
    }
  }
  return String(error)
}

/**
 * Filter stored Sessions to the ones this surface can offer in `/resume`.
 * @param records - newest-first stored Session records.
 * @param cwd - execution directory this process exposes.
 * @param currentId - Session currently driven by this surface, excluded from the list.
 * @returns at most 50 adoptable choices in input order.
 */
export function sessionChoices(
  records: readonly SessionRecord[], cwd: string, currentId: string,
): readonly TuiSessionChoice[] {
  return records
    .filter(record => record.header.id !== currentId
      && record.header.cwd === cwd
      && record.header.parentSession === undefined
      && record.header.origin !== 'subagent'
      && record.header.agentPreset === undefined)
    .slice(0, 50)
    .map(record => ({
      id: record.header.id,
      createdAt: record.header.createdAt,
      cwd: record.header.cwd ?? cwd,
      live: record.live,
    }))
}

/** Facts a resumed Session must satisfy before this surface drives it. */
interface SessionFacts {
  readonly route: ModelSelection | undefined
  readonly presetSelected: boolean
}

function sessionFacts(session: Session): SessionFacts {
  let route: ModelSelection | undefined
  let presetSelected = false
  const length = session.seq
  for (let seq = 0; seq < length; seq++) {
    // oxlint-disable-next-line typescript/no-deprecated -- Session history read for the resumed route.
    const event = session.eventAt(SessionSeq(seq))
    if (event === undefined) continue
    const type: string = event.type
    if (type === 'agent-preset/selected') presetSelected = true
    if (event.type !== 'request/header') continue
    const config = event.data.header.config
    route = {
      provider: config.provider,
      model: config.model,
      ...config.reasoningEffort === undefined ? {} : { reasoningEffort: config.reasoningEffort },
    }
  }
  return { route, presetSelected }
}

/**
 * Validate a resumed Session for this surface and read its recorded route.
 * @param session - stored Session adopted by the runtime.
 * @param cwd - execution directory this process exposes.
 * @returns the last recorded model route, or undefined for a Session without a request.
 * @throws when the Session is a child, records an uncomposed preset, or belongs to another directory.
 */
export function adoptedRoute(session: Session, cwd: string): ModelSelection | undefined {
  const facts = sessionFacts(session)
  assertAdoptable(session, cwd, facts)
  return facts.route
}

function assertAdoptable(session: Session, cwd: string, facts: SessionFacts): void {
  if (session.header.origin === 'subagent' || session.header.parentSession !== undefined) {
    throw new Error(`session "${session.id}" is a subagent or forked child and cannot be driven by the terminal surface`)
  }
  if (session.header.agentPreset !== undefined || facts.presetSelected) {
    throw new Error(
      `session "${session.id}" runs under an agent preset the terminal profile does not compose; `
      + 'resume it in the surface that composed that preset',
    )
  }
  if (session.header.cwd === undefined) {
    throw new Error(`session "${session.id}" recorded no working directory, so it cannot be resumed here`)
  }
  if (session.header.cwd !== cwd) {
    throw new Error(`session "${session.id}" was recorded in "${session.header.cwd}", not "${cwd}"`)
  }
}

function parseModelOverride(override: string | undefined, base: ModelSelection): ModelSelection {
  if (override === undefined || override === '') return base
  const separator = override.indexOf('/')
  return separator > 0
    ? { provider: override.slice(0, separator), model: override.slice(separator + 1) }
    : { provider: base.provider, model: override }
}

/** One immutable terminal snapshot plus the Agent that produces it. */
export class TuiRuntime {
  private state: TuiSnapshot
  private readonly listeners = new Set<() => void>()
  private readonly unsubscribers: (() => void)[] = []
  private readonly approvals: PendingApproval[] = []
  private readonly toolCalls = new Map<string, { name: string; arguments: string }>()
  private readonly jobCallIds = new Map<string, string>()
  private readonly jobCursors = new Map<string, number>()
  private jobUnsubscribe: (() => void) | undefined
  private readonly questions: PendingQuestion[] = []
  private readonly pendingEchoes: { id: string; text: string }[] = []
  private handle: AgentHandle | undefined
  private agent: Agent | undefined
  private selection: ModelSelectionRef = { current: undefined, assembled: undefined }
  private cwd: string
  private liveStream: TuiStreamingView | undefined
  private streamTimer: NodeJS.Timeout | undefined
  private commandAbort: AbortController | undefined
  private approvalSeq = 0
  private started = false
  private disposed = false
  private agentStart: Promise<Agent | undefined> | undefined
  private inputHistory: readonly string[] = []
  private historyWrite: Promise<void> = Promise.resolve()
  private historyWriteFailed = false
  private readonly historyFile: string | null

  constructor(private readonly options: TuiRuntimeOptions) {
    this.cwd = process.cwd()
    this.state = initialSnapshot({ sessionId: '', cwd: this.cwd, provider: '', model: '' })
    this.historyFile = options.historyFile === null
      ? null
      : options.historyFile ?? join(resolveDshHome(), 'tui', 'history.json')
  }

  /** Read the current immutable render state. */
  getSnapshot = (): TuiSnapshot => this.state

  /**
   * Observe render-state changes.
   * @param listener - callback invoked after every committed snapshot.
   * @returns a disposer that stops further notifications.
   */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /**
   * Read the composer history loaded for this surface.
   * @returns retained entries in submission order.
   */
  history(): readonly string[] {
    return this.inputHistory
  }

  /**
   * Record one submitted composer line and persist it in the background.
   * @param text - submitted composer text; blank lines and repeats are ignored.
   */
  remember(text: string): void {
    const next = rememberInput(this.inputHistory, text, this.options.config.historyLimit)
    if (next === this.inputHistory) return
    this.inputHistory = next
    this.persistHistory()
  }

  /**
   * Prepare the surface, attach event listeners, and load a resumed transcript.
   * A fresh Session is created only when the first prompt or agent command needs one.
   * @returns fulfillment once the surface is idle and renderable.
   */
  async start(): Promise<void> {
    if (this.started) return
    this.started = true
    this.cwd = await this.resolveCwd()
    this.state = { ...this.state, cwd: this.cwd }
    this.subscribeCore()
    await this.loadHistory()
    this.selection = { current: this.initialSelection(this.options.model), assembled: undefined }
    this.showRoute()
    if (this.options.resume !== undefined) {
      const opened = await this.openAgent(this.options.resume, this.options.model)
      this.installOpened(opened)
    }
    this.emit(withStatus(this.state, 'idle'))
  }

  /**
   * Submit composer text as one slash command or one user turn.
   * @param text - verbatim composer content.
   * @returns fulfillment after the command settles or the prompt enters the inbox.
   */
  async submit(text: string): Promise<void> {
    const trimmed = text.trim()
    if (trimmed === '') return
    if (this.state.permission !== undefined || this.state.question !== undefined) return
    if (trimmed.startsWith('/')) {
      await this.dispatchCommand(trimmed)
      return
    }
    const agent = await this.ensureAgent()
    if (agent === undefined) return
    const id = `local-${randomUUID()}`
    this.emit(withUserMessage(this.state, id, trimmed, this.options.config.maxTranscriptMessages))
    this.pendingEchoes.push({ id, text: trimmed })
    try {
      agent.followup(createUserMessage({ content: [{ type: 'text', text: trimmed }], source: { kind: 'user' } }))
    } catch (error) {
      const echo = this.pendingEchoes.findIndex(entry => entry.id === id)
      if (echo >= 0) this.pendingEchoes.splice(echo, 1)
      this.emit({ ...this.state, transcript: this.state.transcript.filter(message => message.id !== id) })
      this.error(errorText(error))
    }
  }

  /**
   * Slash commands offered by composer prediction and completion.
   * @returns terminal-owned commands in presentation order, then registered agent commands in name order.
   */
  commandCatalog(): readonly TuiCommandInfo[] {
    const agent = this.agent
    const registered = agent === undefined ? [] : this.options.ctx.get('commands')?.list(agent) ?? []
    const local = new Set(LOCAL_COMMAND_INFO.map(command => command.name))
    const agentCommands: TuiCommandInfo[] = registered
      .filter(command => !local.has(command.name))
      .map(command => ({
        name: command.name,
        description: command.description,
        ...command.input === undefined ? {} : { hint: command.input.hint },
      }))
      .sort((left, right) => left.name.localeCompare(right.name))
    return [...LOCAL_COMMAND_INFO, ...agentCommands]
  }

  /**
   * Open the interactive `/resume` picker with sessions recorded in this directory.
   * @returns fulfillment once the picker state is published.
   */
  async openSessionPicker(): Promise<void> {
    const query = this.options.ctx.get('sessionQuery')
    if (query === undefined) {
      this.error('Session history is not available in this profile.')
      return
    }
    const choices = sessionChoices(await query.listSessions(), this.cwd, this.state.sessionId)
    if (choices.length === 0) {
      this.info('No resumable Sessions in this directory.')
      return
    }
    const sessions = await this.withSessionTitles(query, choices)
    this.emit(withPicker(withModelPicker(this.state, undefined), { sessions, query: '', index: 0 }))
  }

  /**
   * Attach folded titles to picker rows; title lookup failures keep the id-only rows.
   * @param query - Session query service used for title folds.
   * @param choices - resumable rows in display order.
   * @returns rows with a title where the log has one.
   */
  private async withSessionTitles(
    query: SessionQueryEngine,
    choices: readonly TuiSessionChoice[],
  ): Promise<readonly TuiSessionChoice[]> {
    let titles: Map<string, string>
    try {
      const observations = await query.readTitleSnapshots(
        choices.map(choice => brandString<SessionId>(choice.id)),
      )
      titles = new Map(observations.flatMap((observation) => {
        if (observation.status === 'fulfilled' && observation.value.title !== undefined) {
          return [[String(observation.sessionId), observation.value.title.title] as const]
        }
        return []
      }))
    } catch (error) {
      this.error(`Session titles are unavailable: ${errorText(error)}`)
      return choices
    }
    return choices.map((choice) => {
      const title = titles.get(choice.id)
      return title === undefined ? choice : { ...choice, title }
    })
  }

  /**
   * Move the `/resume` picker highlight.
   * @param delta - signed row offset.
   */
  movePicker(delta: number): void {
    this.emit(withPickerIndex(this.state, delta))
  }

  /**
   * Replace the `/resume` picker's id or title filter.
   * @param query - case-insensitive id or title fragment.
   */
  setPickerQuery(query: string): void {
    this.emit(withPickerQuery(this.state, query))
  }

  /** Dismiss the `/resume` picker without resuming. */
  closePicker(): void {
    if (this.state.picker === undefined) return
    this.emit(withPicker(this.state, undefined))
  }

  /** Resume the Session highlighted by the `/resume` picker. */
  confirmPicker(): void {
    const picker = this.state.picker
    if (picker === undefined) return
    const choice = filterSessionChoices(picker.sessions, picker.query)[picker.index]
    if (choice === undefined) return
    this.emit(withPicker(this.state, undefined))
    void this.resumeSession(choice.id)
  }

  /**
   * Open the two-step `/model` picker with every model advertised by the composed providers.
   * @returns fulfillment once the model step is published.
   */
  async openModelPicker(): Promise<void> {
    const llm = this.options.ctx.get('llm')
    if (llm === undefined) {
      this.error('The model registry is not composed in this profile.')
      return
    }
    const models: TuiModelChoice[] = []
    for (const provider of llm.listProviders()) {
      let listed: readonly LlmModelInfo[]
      try {
        listed = await llm.listModels(provider.id)
      } catch {
        // One provider's catalog may need credentials the profile lacks; omit it.
        continue
      }
      for (const model of listed) {
        models.push({
          provider: provider.id,
          model: model.id,
          name: model.name,
          ...model.description === undefined ? {} : { description: model.description },
        })
      }
    }
    const current = this.selection.current
    if (models.length === 0) {
      if (current === undefined) {
        this.error('No models are available in this profile.')
        return
      }
      models.push({ provider: current.provider, model: current.model, name: current.model })
      this.info('No provider model catalog is available; showing the current model. Configure credentials to list more.')
    }
    const index = Math.max(0, models.findIndex(choice => choice.provider === current?.provider && choice.model === current.model))
    this.emit(withModelPicker(withPicker(this.state, undefined), { step: 'model', models, index }))
  }

  /**
   * Move the model picker highlight within its current step.
   * @param delta - signed row offset.
   */
  moveModelPicker(delta: number): void {
    this.emit(withModelPickerIndex(this.state, delta))
  }

  /** Dismiss the model picker without changing the selection. */
  closeModelPicker(): void {
    if (this.state.modelPicker === undefined) return
    this.emit(withModelPicker(this.state, undefined))
  }

  /**
   * Confirm the highlighted model, then the highlighted reasoning effort.
   * A model without advertised efforts applies immediately.
   * @returns fulfillment after the model step resolves or the selection applies.
   */
  async confirmModelPicker(): Promise<void> {
    const picker = this.state.modelPicker
    if (picker === undefined) return
    if (picker.step === 'effort') {
      const effort = picker.efforts[picker.index]
      if (effort === undefined) return
      await this.applyModel(picker.provider, picker.model, effort.id === '' ? undefined : effort.id)
      return
    }
    const choice = picker.models[picker.index]
    if (choice === undefined) return
    let efforts: TuiEffortChoice[] = []
    try {
      const info = await this.options.ctx.get('llm')?.resolveModelInfo(choice.provider, choice.model)
      const reasoning = info?.reasoning
      if (reasoning !== undefined && reasoning.efforts.length > 0) {
        const defaultName = reasoning.defaultEffort === undefined
          ? undefined
          : reasoning.efforts.find(effort => effort.id === reasoning.defaultEffort)?.name
        efforts = [
          { id: '', name: defaultName === undefined ? 'default' : `default (${defaultName})` },
          ...reasoning.efforts.map(effort => ({ id: String(effort.id), name: effort.name })),
        ]
      }
    } catch (error) {
      this.error(`Cannot read ${choice.provider}/${choice.model} metadata: ${errorText(error)}`)
      return
    }
    if (efforts.length === 0) {
      await this.applyModel(choice.provider, choice.model, undefined)
      return
    }
    const currentEffort = this.selection.current?.reasoningEffort
    const index = Math.max(0, efforts.findIndex(effort => effort.id === (currentEffort === undefined ? '' : String(currentEffort))))
    this.emit(withModelPicker(this.state, {
      step: 'effort',
      provider: choice.provider,
      model: choice.model,
      name: choice.name,
      efforts,
      index,
    }))
  }

  private async applyModel(provider: string, model: string, reasoningEffort: string | undefined): Promise<void> {
    const selection: ModelSelection = {
      provider,
      model,
      ...reasoningEffort === undefined ? {} : { reasoningEffort: ReasoningEffortId(reasoningEffort) },
    }
    this.selection.current = selection
    this.emit(withContextWindow(
      withModelPicker(
        withRoute(this.state, provider, model, reasoningEffort),
        undefined,
      ),
      undefined,
    ))
    try {
      await this.options.ctx.get('agentDefaultModel')?.saveSelection(selection)
    } catch (error) {
      this.error(`The default model was not saved: ${errorText(error)}`)
    }
    this.refreshModelInfo()
  }

  private refreshModelInfo(): void {
    const llm = this.options.ctx.get('llm')
    const current = this.selection.current
    if (llm === undefined || current === undefined) return
    void llm.resolveModelInfo(current.provider, current.model).then((info) => {
      const latest = this.selection.current
      if (latest?.provider !== current.provider || latest.model !== current.model) return
      this.emit(withContextWindow(this.state, info.context?.contextWindow))
    }, () => {
      // Metadata is advisory; an unavailable catalog leaves the window unknown.
    })
  }

  /** Abort the active turn and any running command. */
  interrupt(): void {
    this.commandAbort?.abort()
    if (this.agent?.status === 'running') this.agent.cancel({ kind: 'user' }, { keepInbox: true })
  }

  /**
   * Answer the head approval question.
   * @param outcome - one-shot grant or explicit rejection.
   */
  resolvePermission(outcome: ApprovalOutcome): void {
    this.approvals[0]?.resolve(outcome)
  }

  /**
   * Select or deselect one option on the active question.
   * @param label - option label to toggle.
   */
  toggleQuestionOption(label: string): void {
    const item = this.state.question?.questions[this.state.question.active]
    if (item === undefined || item.options?.some(option => option.label === label) !== true) return
    this.emit(withQuestionOption(this.state, label))
    this.syncQuestion()
  }

  /**
   * Replace the free-text answer for the active question.
   * @param text - complete custom answer.
   */
  setQuestionCustom(text: string): void {
    this.emit(withQuestionCustom(this.state, text))
    this.syncQuestion()
  }

  /**
   * Move between questions in a multi-question batch.
   * @param delta - signed question offset.
   */
  stepQuestion(delta: number): void {
    this.emit(withQuestionStep(this.state, delta))
    this.syncQuestion()
  }

  /** Submit the assembled answers for the head question batch. */
  submitQuestion(): void {
    const head = this.questions[0]
    const view = this.state.question
    if (head === undefined || view === undefined) return
    for (const item of view.questions) {
      const selected = view.selected[item.id] ?? []
      const custom = view.custom[item.id] ?? ''
      if ((item.options?.length ?? 0) > 0 && selected.length === 0 && custom.trim() === '') {
        this.error(`Select an option for: ${item.question}`)
        return
      }
    }
    const answers = view.questions.map((item) => {
      const selected = view.selected[item.id] ?? []
      const custom = (view.custom[item.id] ?? '').trim()
      return {
        id: item.id,
        selected: [...selected],
        ...custom === '' ? {} : { custom },
      }
    })
    this.questions.shift()
    head.resolve({ answers })
    this.showPrompts()
  }

  /** Render no transcript entries; durable Session history is untouched. */
  clearTranscript(): void {
    this.emit(withClearedTranscript(this.state))
  }

  /**
   * Flush and release the Agent, abort pending prompts, and detach listeners.
   * Safe to call more than once.
   * @returns fulfillment after owned resources are released.
   */
  async shutdown(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    this.clearStreamTimer()
    for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe()
    this.resolveAllPrompts()
    this.emit(withStopped(this.state))
    await this.historyWrite
    await this.closeAgent()
  }

  /**
   * Load durable composer history, reporting a read failure without blocking startup.
   * @returns fulfillment after the read attempt.
   */
  private async loadHistory(): Promise<void> {
    const file = this.historyFile
    if (file === null) return
    try {
      this.inputHistory = await readHistoryFile(file, this.options.config.historyLimit)
    } catch (error) {
      this.info(`Composer history could not be read: ${errorText(error)}`)
    }
  }

  /**
   * Queue one atomic history write; the first failure is reported once.
   */
  private persistHistory(): void {
    const file = this.historyFile
    if (file === null) return
    const entries = this.inputHistory
    this.historyWrite = this.historyWrite
      .then(() => writeHistoryFile(file, entries))
      .catch((error: unknown) => {
        if (this.historyWriteFailed) return
        this.historyWriteFailed = true
        this.info(`Composer history could not be saved: ${errorText(error)}`)
      })
  }

  private emit(next: TuiSnapshot): void {
    this.state = next
    for (const listener of [...this.listeners]) listener()
  }

  private error(text: string): void {
    this.emit(withSystemNotice(this.state, 'error', text, this.options.config.maxTranscriptMessages))
  }

  private info(text: string): void {
    this.emit(withSystemNotice(this.state, 'info', text, this.options.config.maxTranscriptMessages))
  }

  private async resolveCwd(): Promise<string> {
    const fs: FileSystem | undefined = this.options.ctx.get('fs')
    if (fs === undefined) return process.cwd()
    return fs.processPath(await fs.resolve('.'))
  }

  private requireAgentDefaultModel(): Context['agentDefaultModel'] {
    const service = this.options.ctx.get('agentDefaultModel')
    if (service === undefined) throw new Error('dsh tui requires the agentDefaultModel service; dsh-base provides it')
    return service
  }

  private initialSelection(model: string | undefined): ModelSelection {
    const base = this.requireAgentDefaultModel().currentSelection()
    return parseModelOverride(model, base)
  }

  /** Publish the selected route and its context window before any Agent exists. */
  private showRoute(): void {
    const route = this.selection.current
    this.emit(withRoute(
      this.state,
      route?.provider ?? '',
      route?.model ?? '',
      route?.reasoningEffort === undefined ? undefined : String(route.reasoningEffort),
    ))
    this.refreshModelInfo()
  }

  /**
   * Start the first Agent for this surface, reusing one concurrent start.
   * @returns the live Agent, or undefined when creation failed.
   */
  private ensureAgent(): Promise<Agent | undefined> {
    if (this.agent !== undefined) return Promise.resolve(this.agent)
    if (this.agentStart !== undefined) return this.agentStart
    this.agentStart = (async () => {
      this.emit(withStatus(this.state, 'starting'))
      try {
        const opened = await this.openAgent(undefined, undefined)
        if (this.disposed) {
          await opened.handle.dispose()
          return undefined
        }
        this.installOpened(opened)
        this.emit(withStatus(this.state, 'idle'))
        return opened.handle.agent
      } catch (error) {
        this.error(`The Agent could not start: ${errorText(error)}`)
        this.emit(withStatus(this.state, 'idle'))
        return undefined
      } finally {
        this.agentStart = undefined
      }
    })()
    return this.agentStart
  }

  private async openAgent(resume: string | undefined, model: string | undefined): Promise<{
    handle: AgentHandle
    selection: ModelSelectionRef
  }> {
    const agents = this.options.ctx.get('agents')
    if (agents === undefined) throw new Error('dsh tui requires the agents service; load an agent loop')
    const selection: ModelSelectionRef = {
      current: this.selection.current ?? this.initialSelection(model),
      assembled: undefined,
    }
    const selected = selection.current
    const agentOptions: AgentOptions = selected === undefined ? {} : { ...selected }
    const setup = (agentCtx: Context): void => { installModelSelection(agentCtx, selection) }
    if (resume !== undefined) {
      const handle = await agents.resume({ resumeSessionId: brandString<SessionId>(resume), agentOptions, setup })
      try {
        const route = adoptedRoute(handle.agent.session, this.cwd)
        if (model === undefined && route !== undefined) selection.current = route
      } catch (error) {
        await handle.dispose()
        throw error
      }
      return { handle, selection }
    }
    const handle = await agents.create({
      sessionId: brandString<SessionId>(`session-${randomUUID()}`),
      meta: { cwd: this.cwd },
      agentOptions,
      setup,
    })
    return { handle, selection }
  }

  private installOpened(opened: { handle: AgentHandle; selection: ModelSelectionRef }): void {
    this.toolCalls.clear()
    this.handle = opened.handle
    this.agent = opened.handle.agent
    this.selection = opened.selection
    const route = opened.selection.current
    this.state = withSession(
      this.state,
      opened.handle.agent.session.id,
      this.cwd,
      route?.provider ?? '',
      route?.model ?? '',
    )
    this.state = withRoute(
      this.state,
      route?.provider ?? '',
      route?.model ?? '',
      route?.reasoningEffort === undefined ? undefined : String(route.reasoningEffort),
    )
    this.hydrate(opened.handle.agent.session)
    this.subscribeJobs(opened.handle.agent.session.id)
    this.refreshModelInfo()
  }

  private hydrate(session: Session): void {
    let state = this.state
    const length = session.seq
    for (let seq = 0; seq < length; seq++) {
      // oxlint-disable-next-line typescript/no-deprecated -- Loading a resumed Session transcript.
      const event = session.eventAt(SessionSeq(seq))
      if (event === undefined) break
      state = this.hydrateEvent(state, event)
    }
    this.state = { ...state, status: 'idle', streaming: undefined }
  }

  private hydrateEvent(state: TuiSnapshot, event: SessionEvent): TuiSnapshot {
    switch (event.type) {
      case 'turn/start':
        return { ...state, turn: event.data.turn }
      case 'turn/end':
        return { ...state, turn: event.data.turn, status: 'idle', streaming: undefined }
      case 'user/message':
        return event.data.source.kind === 'user'
          ? withUserMessage(state, `user-${String(event.seq)}`, userMessageText(event.data.content), this.options.config.maxTranscriptMessages)
          : state
      case 'assistant/message':
        return withAssistantMessage(state, event, this.options.config.maxTranscriptMessages)
      case 'tool/result':
        return this.withResult(state, event)
      case 'request/header': {
        const config = event.data.header.config
        return withRoute(
          state,
          config.provider,
          config.model,
          config.reasoningEffort === undefined ? undefined : String(config.reasoningEffort),
        )
      }
      default:
        return state
    }
  }

  private withResult(state: TuiSnapshot, event: SessionEvent<'tool/result'>): TuiSnapshot {
    const data = event.data
    const diffs = resultDiffs(data.meta)
    return withToolResult(state, data.message.toolCallId, {
      output: toolResultText(data.message.content),
      isError: data.message.isError,
      ...data.error?.code === undefined ? {} : { code: data.error.code },
      ...data.error === undefined ? {} : { reason: toolErrorText(data.error.code, data.error.reason) },
      ...diffs === undefined ? {} : { diffs },
    })
  }

  private subscribeCore(): void {
    const ctx = this.options.ctx
    this.unsubscribers.push(ctx.on('session/event', (session, event) => {
      if (session !== this.agent?.session) return
      this.handleSessionEvent(event)
    }))
    this.unsubscribers.push(ctx.on('agent/assistant-stream', ({ agent, frame }) => {
      if (agent !== this.agent) return
      this.handleStreamFrame(frame)
    }))
    this.unsubscribers.push(ctx.on('agent/status', ({ agent, status }) => {
      if (agent !== this.agent || this.state.status === 'stopped') return
      this.emit(withStatus(this.state, status))
    }))
    this.unsubscribers.push(ctx.on('agent/error', ({ agent, error }) => {
      if (agent !== this.agent) return
      this.error(errorText(error))
    }))
    this.unsubscribers.push(ctx.on('approval/request', async (request, next) => {
      if (request.agent !== this.agent) return next()
      return await this.askApproval(request)
    }))
    this.unsubscribers.push(ctx.on('user-questions/request', async (request, next) => {
      if (request.agent === undefined || request.agent !== this.agent) return next()
      return await this.askQuestions(request)
    }))
  }

  private handleSessionEvent(event: SessionEvent): void {
    switch (event.type) {
      case 'turn/start':
        this.emit(withTurnStart({ ...this.state, permission: undefined, question: undefined }, event.data.turn))
        return
      case 'turn/end':
        this.liveStream = undefined
        this.clearStreamTimer()
        this.resolveAllPrompts()
        this.emit(withTurnEnd({ ...this.state, permission: undefined, question: undefined }, event.data.reason))
        return
      case 'user/message': {
        if (event.data.source.kind !== 'user') return
        const text = userMessageText(event.data.content)
        const echo = this.pendingEchoes.findIndex(entry => entry.text === text)
        if (echo >= 0) {
          this.pendingEchoes.splice(echo, 1)
          return
        }
        this.emit(withUserMessage(this.state, `user-${String(event.seq)}`, text, this.options.config.maxTranscriptMessages))
        return
      }
      case 'assistant/message':
        this.emit(withAssistantMessage(this.state, event, this.options.config.maxTranscriptMessages))
        return
      case 'assistant/attempt':
        if (this.state.streaming?.turn === event.data.turn && this.state.streaming.step === event.data.step) {
          this.emit(withStreaming(this.state, undefined))
        }
        return
      case 'job/registered':
        if (event.data.toolCall !== undefined) {
          this.jobCallIds.set(String(event.data.jobId), String(event.data.toolCall.callId))
          this.jobCursors.set(String(event.data.jobId), 0)
        }
        return
      case 'job/settled': {
        const id = String(event.data.jobId)
        this.applyJobOutput(id)
        this.jobCallIds.delete(id)
        this.jobCursors.delete(id)
        return
      }
      case 'tool/call':
        this.toolCalls.set(String(event.data.callId), {
          name: event.data.name,
          arguments: event.data.arguments,
        })
        return
      case 'tool/result':
        this.emit(this.withResult(this.state, event))
        return
      case 'request/header': {
        const config = event.data.header.config
        this.emit(withRoute(
          this.state,
          config.provider,
          config.model,
          config.reasoningEffort === undefined ? undefined : String(config.reasoningEffort),
        ))
        this.refreshModelInfo()
        return
      }
      default:
        return
    }
  }

  private handleStreamFrame(frame: AssistantStreamFrame): void {
    switch (frame.type) {
      case 'start':
        this.liveStream = { turn: frame.turn, step: frame.step, text: '', reasoning: '' }
        this.scheduleStream()
        return
      case 'chunk': {
        const chunk = frame.chunk
        const current = this.liveStream
        if (current === undefined) return
        if (chunk.type === 'text-delta') {
          this.liveStream = { ...current, text: current.text + chunk.text }
          this.scheduleStream()
        } else if (chunk.type === 'reasoning-delta') {
          this.liveStream = { ...current, reasoning: current.reasoning + chunk.text }
          this.scheduleStream()
        }
        return
      }
      case 'end':
        this.liveStream = undefined
        this.flushStream()
        return
      default:
        return
    }
  }

  private scheduleStream(): void {
    if (this.options.config.streamFrameMs <= 0) {
      this.flushStream()
      return
    }
    if (this.streamTimer !== undefined) return
    this.streamTimer = setTimeout(() => {
      this.streamTimer = undefined
      this.flushStream()
    }, this.options.config.streamFrameMs)
    this.streamTimer.unref()
  }

  private flushStream(): void {
    this.clearStreamTimer()
    const streaming = this.liveStream
    if (streaming === undefined && this.state.streaming === undefined) return
    this.emit(withStreaming(this.state, streaming === undefined ? undefined : { ...streaming }))
  }

  private clearStreamTimer(): void {
    if (this.streamTimer === undefined) return
    clearTimeout(this.streamTimer)
    this.streamTimer = undefined
  }

  private async dispatchCommand(line: string): Promise<void> {
    const command = parseSlashCommand(line)
    if (command === undefined) {
      this.error('Not a command. Commands start with "/" followed by a lowercase name.')
      return
    }
    const host: CommandHost = {
      ctx: this.options.ctx,
      agent: this.agent,
      selection: this.selection,
      snapshot: this.state,
      info: (text) => { this.info(text) },
      error: (text) => { this.error(text) },
      setRoute: (selection) => {
        this.selection.current = selection
        this.emit(withRoute(
          this.state,
          selection.provider,
          selection.model,
          selection.reasoningEffort === undefined ? undefined : String(selection.reasoningEffort),
        ))
        this.refreshModelInfo()
      },
      requestExit: () => { this.requestExit() },
      openSessionPicker: () => this.openSessionPicker(),
      openModelPicker: () => this.openModelPicker(),
      newSession: () => this.newSession(),
      resumeSession: id => this.resumeSession(id),
      clearTranscript: () => { this.clearTranscript() },
    }
    if (await runLocalCommand(command, host)) return
    const commands = this.options.ctx.get('commands')
    if (commands === undefined) {
      this.error(`Unknown command /${command.name}; this profile composes no command registry.`)
      return
    }
    const agent = await this.ensureAgent()
    if (agent === undefined) return
    const abort = new AbortController()
    this.commandAbort = abort
    try {
      const execution = await commands.execute(agent, line, [], abort.signal)
      if (execution === undefined) {
        this.error(`Unknown command /${command.name}. Use /help to list commands.`)
      } else if (execution.result.kind === 'error') {
        this.error(execution.result.text)
      } else if (execution.result.text !== undefined) {
        this.info(execution.result.text)
      }
    } catch (error) {
      if (!abort.signal.aborted) this.error(errorText(error))
    } finally {
      if (this.commandAbort === abort) this.commandAbort = undefined
    }
  }

  private requestExit(): void {
    if (this.options.onExit !== undefined) {
      this.options.onExit()
      return
    }
    void this.shutdown().finally(() => { this.options.io.exit(0) })
  }

  private async newSession(): Promise<void> {
    if (this.state.status === 'running') {
      this.error('Stop the running turn before switching Sessions.')
      return
    }
    const previous = this.handle
    this.resetToUnstarted()
    if (previous !== undefined) {
      try {
        await previous.dispose()
      } catch (error) {
        this.error(`The previous Session did not close cleanly: ${errorText(error)}`)
      }
    }
  }

  private async resumeSession(id: string): Promise<void> {
    await this.replaceAgent(id)
  }

  private async replaceAgent(resume: string): Promise<void> {
    if (this.state.status === 'running') {
      this.error('Stop the running turn before switching Sessions.')
      return
    }
    this.emit(withStatus(this.state, 'starting'))
    let opened: { handle: AgentHandle; selection: ModelSelectionRef }
    try {
      opened = await this.openAgent(resume, undefined)
    } catch (error) {
      this.error(errorText(error))
      this.emit(withStatus(this.state, 'idle'))
      return
    }
    const previous = this.handle
    this.pendingEchoes.splice(0)
    this.installOpened(opened)
    this.emit(withStatus(this.state, 'idle'))
    if (previous !== undefined) {
      try {
        await previous.dispose()
      } catch (error) {
        this.error(`The previous Session did not close cleanly: ${errorText(error)}`)
      }
    }
  }

  /**
   * Return to the prompt-only state without creating stored Session data.
   */
  private resetToUnstarted(): void {
    this.jobUnsubscribe?.()
    this.jobUnsubscribe = undefined
    this.jobCallIds.clear()
    this.jobCursors.clear()
    this.toolCalls.clear()
    this.pendingEchoes.splice(0)
    this.agent = undefined
    this.handle = undefined
    this.liveStream = undefined
    this.clearStreamTimer()
    const route = this.selection.current
    this.state = initialSnapshot({
      sessionId: '',
      cwd: this.cwd,
      provider: route?.provider ?? '',
      model: route?.model ?? '',
    })
    this.state = withStatus(withRoute(
      this.state,
      route?.provider ?? '',
      route?.model ?? '',
      route?.reasoningEffort === undefined ? undefined : String(route.reasoningEffort),
    ), 'idle')
    this.refreshModelInfo()
  }

  /**
   * Follow job output for the exact Session this surface drives.
   * @param sessionId - owning Session of the jobs to observe.
   */
  private subscribeJobs(sessionId: SessionId): void {
    this.jobUnsubscribe?.()
    this.jobUnsubscribe = undefined
    this.jobCallIds.clear()
    this.jobCursors.clear()
    const jobs = this.options.ctx.get('jobs')
    if (jobs === undefined) return
    this.jobUnsubscribe = jobs.events.subscribe({ owner: sessionId }, (event: JobEvent) => {
      if (event.type === 'output') this.applyJobOutput(String(event.id))
    })
  }

  /**
   * Copy newly retained output of one mapped job into its pending tool block.
   * @param jobId - job whose output advanced.
   */
  private applyJobOutput(jobId: string): void {
    const callId = this.jobCallIds.get(jobId)
    if (callId === undefined) return
    const jobs = this.options.ctx.get('jobs')
    if (jobs === undefined) return
    const from = this.jobCursors.get(jobId) ?? 0
    try {
      const read = jobs.readAt(JobId(jobId), from, brandString<SessionId>(this.state.sessionId))
      this.jobCursors.set(jobId, read.next)
      if (read.chunks.length === 0) return
      const text = `${read.lossy ? '… earlier output lost\n' : ''}${read.chunks.map(chunk => chunk.text).join('')}`
      this.emit(withToolOutput(this.state, callId, text, this.options.config.toolOutputChars))
    } catch (error) {
      this.jobCallIds.delete(jobId)
      this.jobCursors.delete(jobId)
      this.info(`Live tool output stopped: ${errorText(error)}`)
    }
  }

  /**
   * Build the approval panel from the exact logged call and its tool presenter.
   * @param request - pending approval request.
   * @returns the base approval facts plus any pending-call presentation detail.
   */
  private permissionView(request: ApprovalAsk): TuiPermissionView {
    const base: TuiPermissionView = {
      id: request.callId ?? `approval-${String(++this.approvalSeq)}`,
      toolName: request.toolName,
      ...request.displayReason?.en === undefined
        ? request.reason === undefined ? {} : { reason: request.reason }
        : { reason: request.displayReason.en },
    }
    const call = request.callId === undefined ? undefined : this.toolCalls.get(String(request.callId))
    if (call === undefined) return base
    let args: unknown
    try {
      args = JSON.parse(call.arguments)
    } catch (error) {
      this.info(`Tool arguments could not be shown: ${errorText(error)}`)
      return base
    }
    const presentation = this.options.ctx.get('tools')?.get(call.name, request.agent)?.presentCall?.(args)
    return presentation === undefined ? base : this.withPresentation(base, presentation)
  }

  /**
   * Merge one tool-owned pending-call presentation into the approval panel.
   * @param base - approval id, tool name, and reason.
   * @param presentation - tool-declared render intent.
   * @returns the approval view with the presentation's title, command, or bounded diff.
   */
  private withPresentation(base: TuiPermissionView, presentation: ToolCallView): TuiPermissionView {
    switch (presentation.card) {
      case 'terminal':
        return {
          ...base,
          command: presentation.title,
          ...presentation.description === undefined ? {} : { description: presentation.description },
          ...presentation.cwd === undefined ? {} : { cwd: presentation.cwd },
        }
      case 'diff':
        return { ...base, title: presentation.title, details: this.permissionDetails(presentation.diffs) }
      case 'generic':
        return { ...base, title: presentation.title }
      default:
        return assertNever(presentation)
    }
  }

  /**
   * Render a bounded unified-diff preview for one approval panel.
   * @param diffs - files the call changes.
   * @returns preview lines limited by `toolOutputLines`.
   */
  private permissionDetails(diffs: readonly TuiFileDiff[]): readonly TuiPermissionDetail[] {
    const limit = Math.max(3, Math.min(12, this.options.config.toolOutputLines))
    const details: TuiPermissionDetail[] = []
    for (const diff of diffs) {
      details.push({ kind: 'path', text: diff.path })
      for (const hunk of computeDiff(
        diff.oldText, diff.newText, this.options.config.diffContextLines, this.options.config.diffMaxLines,
      )) {
        details.push({ kind: 'hunk', text: diffHunkHeader(hunk) })
        for (const line of hunk.lines) {
          details.push({
            kind: line.kind,
            text: `${line.kind === 'added' ? '+' : line.kind === 'removed' ? '-' : ' '} ${String(line.kind === 'added' ? line.newNumber : line.oldNumber ?? '').padStart(4)} ${line.text}`,
          })
        }
      }
    }
    if (details.length <= limit) return details
    return [
      ...details.slice(0, limit - 1),
      { kind: 'truncated', text: `… ${String(details.length - limit + 1)} more line(s)` },
    ]
  }

  private askApproval(request: ApprovalAsk): Promise<ApprovalOutcome> {
    if (request.signal?.aborted === true) return Promise.resolve('cancelled')
    const view = this.permissionView(request)
    return new Promise<ApprovalOutcome>((resolve) => {
      const settle = (outcome: ApprovalOutcome): void => {
        const index = this.approvals.findIndex(entry => entry.view.id === view.id)
        if (index === -1) return
        this.approvals.splice(index, 1)
        request.signal?.removeEventListener('abort', onAbort)
        resolve(outcome)
        this.showPrompts()
      }
      const onAbort = (): void => { settle('cancelled') }
      this.approvals.push({ view, resolve: settle })
      request.signal?.addEventListener('abort', onAbort, { once: true })
      this.showPrompts()
    })
  }

  private askQuestions(request: QuestionAsk): Promise<AskUserQuestionAnswer> {
    if (request.signal?.aborted === true) return Promise.reject(new Error('question aborted'))
    const view: TuiQuestionView = {
      id: randomUUID(),
      questions: request.questions,
      selected: {},
      custom: {},
      active: 0,
    }
    return new Promise<AskUserQuestionAnswer>((resolve, reject) => {
      const entry: PendingQuestion = { view, resolve, reject }
      const onAbort = (): void => {
        const index = this.questions.indexOf(entry)
        if (index !== -1) this.questions.splice(index, 1)
        request.signal?.removeEventListener('abort', onAbort)
        reject(new Error('question aborted'))
        this.showPrompts()
      }
      request.signal?.addEventListener('abort', onAbort, { once: true })
      this.questions.push(entry)
      this.showPrompts()
    })
  }

  private syncQuestion(): void {
    const head = this.questions[0]
    if (head !== undefined && this.state.question !== undefined) head.view = this.state.question
  }

  private showPrompts(): void {
    const question = this.questions[0]?.view
    const permission = this.approvals[0]?.view
    this.emit(withQuestion(withPermission(this.state, permission), question))
  }

  private resolveAllPrompts(): void {
    for (const approval of this.approvals.splice(0)) approval.resolve('cancelled')
    for (const question of this.questions.splice(0)) question.reject(new Error('the turn ended before the question was answered'))
  }

  private async closeAgent(): Promise<void> {
    this.jobUnsubscribe?.()
    this.jobUnsubscribe = undefined
    this.jobCallIds.clear()
    this.jobCursors.clear()
    const agent = this.agent
    const handle = this.handle
    this.agent = undefined
    this.handle = undefined
    this.pendingEchoes.splice(0)
    const sessions = this.options.ctx.get('sessions')
    if (agent !== undefined && sessions !== undefined) {
      try {
        await sessions.flush(agent.session)
      } catch (error) {
        this.options.io.stderr.write(`dsh tui: Session flush failed: ${errorText(error)}\n`)
      }
    }
    if (handle !== undefined) {
      try {
        await handle.dispose()
      } catch (error) {
        this.options.io.stderr.write(`dsh tui: Agent close failed: ${errorText(error)}\n`)
      }
    }
  }
}
