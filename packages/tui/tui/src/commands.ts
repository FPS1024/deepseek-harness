/**
 * Slash-command grammar and the commands the terminal surface owns. Any other
 * syntactically valid command line is forwarded to the shared `ctx.commands`
 * registry, so agent-side commands such as `/compact` keep one implementation.
 * @module @deepseek-ai/dsh-tui/commands
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent, ModelSelection, ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-tools'
import type { TuiCommandInfo, TuiSnapshot } from './types.ts'

/** One parsed slash-command line. */
export interface ParsedSlashCommand {
  /** Lowercase command name without the leading slash. */
  readonly name: string
  /** Everything after the name, including its separator whitespace. */
  readonly rawInput: string
}

/** Terminal-owned commands with the explanations shown by prediction and `/help`. */
export const LOCAL_COMMAND_INFO: readonly TuiCommandInfo[] = [
  { name: 'help', description: 'Show terminal commands and registered agent commands.' },
  { name: 'model', description: 'Choose a model and reasoning effort, or switch directly.', hint: '[model|provider/model]' },
  { name: 'session', description: 'Show the current Session, directory, model, and tokens.' },
  { name: 'sessions', description: 'List stored Sessions in this directory.' },
  { name: 'resume', description: 'Choose a stored Session to resume.', hint: '[session-id]' },
  { name: 'new', description: 'Reset to a fresh Session; the next prompt starts it.' },
  { name: 'clear', description: 'Clear the rendered transcript; Session history is unchanged.' },
  { name: 'context', description: 'Show token usage and the model context window.' },
  { name: 'tools', description: 'List the tools visible to this Agent.' },
  { name: 'status', description: 'Show surface status and token totals.' },
  { name: 'exit', description: 'Exit the terminal.' },
]

/** Command names the terminal owns; every other name forwards to `ctx.commands`. */
export const LOCAL_COMMANDS = LOCAL_COMMAND_INFO.map(command => command.name)

/** Effects and shared state a terminal-owned command may use. */
export interface CommandHost {
  readonly ctx: Context
  /** Exact live Agent, absent before the surface finishes starting. */
  readonly agent: Agent | undefined
  readonly selection: ModelSelectionRef
  readonly snapshot: TuiSnapshot
  /** Append an informational transcript notice. */
  info(text: string): void
  /** Append an error transcript notice. */
  error(text: string): void
  /** Apply a new model route to this Agent and the status line. */
  setRoute(selection: ModelSelection): void
  /** Ask the terminal to shut down. */
  requestExit(): void
  /** Replace the current Session with a fresh one. */
  newSession(): Promise<void>
  /** Open the interactive `/resume` picker. */
  openSessionPicker(): Promise<void>
  /** Open the interactive two-step model picker. */
  openModelPicker(): Promise<void>
  /** Resume an existing Session by exact id. */
  resumeSession(id: string): Promise<void>
  /** Drop rendered transcript entries only. */
  clearTranscript(): void
}

/**
 * Parse a slash-command line using the shared grammar: a leading slash, a
 * lowercase name, then end-of-input or whitespace.
 * @param line - submitted composer text.
 * @returns the name and verbatim remainder, or undefined when the line is not a command.
 */
export function parseSlashCommand(line: string): ParsedSlashCommand | undefined {
  const match = /^\/([a-z][a-z0-9_-]*)([\s\S]*)$/.exec(line)
  if (match === null) return undefined
  const name = match[1] ?? ''
  const rest = match[2] ?? ''
  if (rest !== '' && !/^\s/.test(rest)) return undefined
  return { name, rawInput: rest }
}

/**
 * Format a token count for the status bar and command output.
 * @param value - non-negative token count.
 * @returns a compact decimal with a `k` or `M` suffix when large.
 */
export function formatTokens(value: number): string {
  if (value < 1_000) return String(value)
  if (value < 1_000_000) return `${(value / 1_000).toFixed(1)}k`
  return `${(value / 1_000_000).toFixed(1)}M`
}

function formatDate(ms: number): string {
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 16)
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function commandModel(host: CommandHost, input: string): Promise<void> {
  const raw = input.trim()
  if (raw === '') {
    await host.openModelPicker()
    return
  }
  const llm = host.ctx.get('llm')
  const current = host.selection.current
  if (llm === undefined) { host.error('The model registry is not composed in this profile.'); return }
  const separator = raw.indexOf('/')
  const provider = separator > 0 ? raw.slice(0, separator) : current?.provider
  const model = separator > 0 ? raw.slice(separator + 1) : raw
  if (provider === undefined || provider === '' || model === '') {
    host.error('Use /model <model> or /model <provider>/<model>.')
    return
  }
  try {
    await llm.resolveModelInfo(provider, model)
  } catch (error) {
    host.error(`Cannot select ${provider}/${model}: ${errorText(error)}`)
    return
  }
  const next: ModelSelection = { provider, model }
  host.selection.current = next
  host.setRoute(next)
  host.info(`Model set to ${provider}/${model} for the next step.`)
  try {
    await host.ctx.get('agentDefaultModel')?.saveSelection(next)
  } catch (error) {
    host.error(`The default model was not saved: ${errorText(error)}`)
  }
}

/**
 * Round one context-usage percentage for display.
 * @param used - tokens attributed to the current context.
 * @param window - model context window; zero reports zero.
 * @returns an integer percentage clamped to 100.
 */
export function contextPercent(used: number, window: number): number {
  return window <= 0 ? 0 : Math.min(100, Math.round((used / window) * 100))
}

async function commandContext(host: CommandHost): Promise<void> {
  const { tokens, provider, model, reasoningEffort, contextWindow, contextTokens } = host.snapshot
  const lines = [
    `Model: ${provider}/${model} · reasoning ${reasoningEffort ?? 'default'}`,
    `Tokens: input ${formatTokens(tokens.input)}, output ${formatTokens(tokens.output)}, total ${formatTokens(tokens.total)}`,
  ]
  if (tokens.cacheRead > 0 || tokens.cacheWrite > 0) {
    lines.push(`Cache: read ${formatTokens(tokens.cacheRead)}, write ${formatTokens(tokens.cacheWrite)}`)
  }
  if (tokens.reasoning > 0) lines.push(`Reasoning tokens: ${formatTokens(tokens.reasoning)}`)
  let window = contextWindow
  if (window === undefined) {
    try {
      window = (await host.ctx.get('llm')?.resolveModelInfo(provider, model))?.context?.contextWindow
    } catch (error) {
      lines.push(`Context window: unavailable (${errorText(error)})`)
    }
  }
  if (window !== undefined) {
    lines.push(`Context: ${formatTokens(contextTokens)}/${formatTokens(window)} (${String(contextPercent(contextTokens, window))}% used)`)
  }
  host.info(lines.join('\n'))
}

async function commandSessions(host: CommandHost): Promise<void> {
  const query = host.ctx.get('sessionQuery')
  if (query === undefined) { host.error('Session history is not available in this profile.'); return }
  const records = await query.listSessions()
  const shown = records.slice(0, 20)
  if (shown.length === 0) { host.info('No stored sessions.'); return }
  const lines = [`Recent sessions (${String(records.length)} total, newest first):`]
  for (const record of shown) {
    const current = record.header.id === host.snapshot.sessionId ? '*' : ' '
    const live = record.live ? 'live' : record.persisted ? 'stored' : 'unknown'
    lines.push(`${current} ${record.header.id}  ${formatDate(record.header.createdAt)}  ${live}  ${record.header.cwd ?? '-'}`)
  }
  lines.push('', 'Use /resume <id> to continue one.')
  host.info(lines.join('\n'))
}

function commandSession(host: CommandHost): void {
  const snapshot = host.snapshot
  const context = snapshot.contextWindow === undefined
    ? `Context: ${formatTokens(snapshot.contextTokens)} tokens`
    : `Context: ${formatTokens(snapshot.contextTokens)}/${formatTokens(snapshot.contextWindow)} (${String(contextPercent(snapshot.contextTokens, snapshot.contextWindow))}% used)`
  host.info([
    `Session: ${snapshot.sessionId === '' ? 'not started' : snapshot.sessionId}`,
    `Directory: ${snapshot.cwd}`,
    `Model: ${snapshot.provider}/${snapshot.model} · reasoning ${snapshot.reasoningEffort ?? 'default'}`,
    context,
    `Turn: ${String(snapshot.turn)}  Status: ${snapshot.status}`,
    `Tokens: ${formatTokens(snapshot.tokens.total)} total`,
  ].join('\n'))
}

function commandTools(host: CommandHost): void {
  if (host.agent === undefined) {
    host.info('Send a prompt first to start a Session and list its tools.')
    return
  }
  const schemas = host.ctx.get('tools')?.schemas(host.agent) ?? []
  if (schemas.length === 0) { host.info('No tools are visible to this agent.'); return }
  const lines = [`Visible tools (${String(schemas.length)}):`]
  for (const schema of schemas) {
    const description = schema.description.split('\n')[0] ?? ''
    lines.push(`  ${schema.name} — ${description}`)
  }
  host.info(lines.join('\n'))
}

function commandHelp(host: CommandHost): void {
  const lines = ['Terminal commands:']
  for (const command of LOCAL_COMMAND_INFO) {
    const hint = command.hint === undefined ? '' : ` ${command.hint}`
    lines.push(`  /${command.name}${hint}`.padEnd(30) + command.description)
  }
  const registered = host.agent === undefined ? [] : host.ctx.get('commands')?.list(host.agent) ?? []
  if (registered.length > 0) {
    lines.push('', 'Agent commands:')
    for (const command of registered) {
      const hint = command.input === undefined ? '' : ` ${command.input.hint}`
      lines.push(`  /${command.name}${hint} — ${command.description}`)
    }
  }
  host.info(lines.join('\n'))
}

/**
 * Run a terminal-owned command.
 * @param command - parsed slash line.
 * @param host - current Agent, shared context, and transcript effects.
 * @returns whether this command belongs to the terminal.
 */
export async function runLocalCommand(command: ParsedSlashCommand, host: CommandHost): Promise<boolean> {
  const input = command.rawInput.trim()
  switch (command.name) {
    case 'help': commandHelp(host); return true
    case 'model': await commandModel(host, input); return true
    case 'session': commandSession(host); return true
    case 'sessions': await commandSessions(host); return true
    case 'resume':
      if (input === '') {
        await host.openSessionPicker()
        return true
      }
      await host.resumeSession(input)
      return true
    case 'new': await host.newSession(); return true
    case 'clear': host.clearTranscript(); host.info('Transcript cleared; Session history is unchanged.'); return true
    case 'context': await commandContext(host); return true
    case 'tools': commandTools(host); return true
    case 'status': commandSession(host); return true
    case 'exit': host.requestExit(); return true
    default: return false
  }
}
