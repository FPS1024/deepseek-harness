/**
 * Ink host: mounts the React tree on the process streams, restores the
 * terminal before teardown, and maps exit requests onto the runtime shutdown.
 * @module @deepseek-ai/dsh-tui/terminal
 */

import { render, type Instance } from 'ink'
import { createElement } from 'react'
import { App } from './components/App.tsx'
import type { TuiRuntime } from './runtime.ts'
import type { TuiConfig, TuiIo } from './types.ts'

/** One mounted terminal surface. */
export interface TerminalHandle {
  /**
   * Unmount the tree, release the Agent, and request process exit.
   * @param code - process exit code.
   * @param message - optional diagnostic written after the terminal is restored.
   */
  quit(code: number, message?: string): void
  /** Settle when Ink has unmounted. */
  waitUntilExit(): Promise<void>
  /** Restore the terminal without requesting process exit. */
  dispose(): void
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Mount the terminal application.
 * @param runtime - started or starting surface runtime.
 * @param config - display bounds.
 * @param io - process streams and the launcher's exit request.
 * @returns the mounted handle.
 */
export function startTerminal(runtime: TuiRuntime, config: TuiConfig, io: TuiIo): TerminalHandle {
  let exiting = false
  const dispose = (): void => {
    if (exiting) return
    exiting = true
    instance.unmount()
  }
  const quit = (code: number, message?: string): void => {
    if (exiting) return
    dispose()
    if (message !== undefined) io.stderr.write(message)
    let exitCode = code
    void runtime.shutdown()
      .catch((error: unknown) => {
        io.stderr.write(`dsh tui: shutdown failed: ${errorText(error)}\n`)
        exitCode = 1
      })
      .finally(() => { io.exit(exitCode) })
  }
  const instance: Instance = render(createElement(App, {
    runtime,
    config,
    onExit: () => { quit(0) },
  }), {
    stdin: io.stdin,
    stdout: io.stdout,
    stderr: io.stderr,
    exitOnCtrlC: false,
    patchConsole: false,
  })
  return {
    quit,
    waitUntilExit: () => instance.waitUntilExit(),
    dispose,
  }
}
