/**
 * `dsh tui` — the interactive terminal surface. The profile bundle mounts this
 * plugin after `dsh-base`; it creates or resumes one Agent through the core
 * registry and drives a React + Ink frontend from the Session and Assistant
 * event streams. Agent logic stays in the composed core packages.
 * @module @deepseek-ai/dsh-tui
 */

import { parseArgs } from 'node:util'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-cmdline'
import { TuiRuntime } from './runtime.ts'
import { startTerminal, type TerminalHandle } from './terminal.ts'
import type { TuiConfig, TuiIo } from './types.ts'

/** Stable Cordis plugin name. */
export const name = 'tui'

/** Core services and launcher facts the terminal requires before mounting. */
export const inject = ['agents', 'sessions', 'agentDefaultModel', 'cmdlineArgs']

/** Validated terminal configuration; deployment-varying values live here. */
export interface Config extends TuiConfig {}

export const Config: z<Config> = z.object({
  streamFrameMs: z.natural().max(60_000).default(50),
  toolOutputLines: z.natural().min(1).default(12),
  diffContextLines: z.natural().max(100).default(3),
  diffMaxLines: z.natural().min(1).default(2_000),
  maxTranscriptMessages: z.natural().min(1).default(400),
  historyLimit: z.natural().max(10_000).default(200),
  toolOutputChars: z.natural().max(1_000_000).default(64_000),
})

const HELP = `dsh tui — interactive terminal agent

Usage:
  dsh tui [options]

Options:
  -r, --resume <id>    Resume an existing Session by exact id
  -m, --model <name>   Start with a model override (model or provider/model)
  -h, --help           Show this help

Keys:
  Enter send · Shift+Enter newline · Ctrl+C interrupt · Ctrl+D exit
  PageUp/PageDown scroll · Ctrl+T expand reasoning · /help commands
`

type Invocation =
  | { readonly kind: 'run'; readonly resume?: string; readonly model?: string }
  | { readonly kind: 'help' }
  | { readonly kind: 'error'; readonly message: string }

function parseInvocation(args: readonly string[]): Invocation {
  try {
    const { values } = parseArgs({
      args: [...args],
      options: {
        resume: { type: 'string', short: 'r' },
        model: { type: 'string', short: 'm' },
        help: { type: 'boolean', short: 'h' },
      },
      allowPositionals: false,
      strict: true,
    })
    if (values.help === true) return { kind: 'help' }
    if (values.resume === '') return { kind: 'error', message: '--resume needs a Session id' }
    if (values.model === '') return { kind: 'error', message: '--model needs a model id' }
    return {
      kind: 'run',
      ...values.resume === undefined ? {} : { resume: values.resume },
      ...values.model === undefined ? {} : { model: values.model },
    }
  } catch (error) {
    return { kind: 'error', message: error instanceof Error ? error.message : String(error) }
  }
}

function requestExit(ctx: Context, code: number): void {
  const exit = ctx.get('appExit')
  if (exit === undefined) {
    process.exitCode = code
    return
  }
  exit(code)
}

function writeHelp(ctx: Context, code: number): void {
  process.stdout.write(HELP)
  requestExit(ctx, code)
}

/**
 * Mount the terminal surface.
 * @param ctx - plugin context carrying core services and launcher facts.
 * @param config - validated display bounds.
 */
export function apply(ctx: Context, config: Config): void {
  const invocation = parseInvocation(ctx.get('cmdlineArgs')?.get() ?? [])
  if (invocation.kind === 'help') {
    writeHelp(ctx, 0)
    return
  }
  if (invocation.kind === 'error') {
    process.stderr.write(`dsh tui: ${invocation.message}\n\n${HELP}`)
    requestExit(ctx, 1)
    return
  }
  if (!process.stdin.isTTY) {
    process.stderr.write('dsh tui: an interactive terminal is required (stdin is not a TTY).\n')
    requestExit(ctx, 1)
    return
  }
  const io: TuiIo = {
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
    exit: (code) => { requestExit(ctx, code) },
  }
  const exitRef: { current?: () => void } = {}
  const runtime = new TuiRuntime({
    ctx,
    config,
    io,
    resume: invocation.resume,
    model: invocation.model,
    onExit: () => { exitRef.current?.() },
  })
  const terminal: TerminalHandle = startTerminal(runtime, config, io)
  exitRef.current = () => { terminal.quit(0) }
  ctx.effect(() => () => { terminal.dispose(); void runtime.shutdown() })
  void runtime.start().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    terminal.quit(1, `dsh tui: ${message}\n`)
  })
}
