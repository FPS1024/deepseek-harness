/**
 * Ink hooks owned by the terminal surface.
 * @module @deepseek-ai/dsh-tui/components/hooks
 */

import { useStdout } from 'ink'
import { useEffect, useState } from 'react'

/** Fallback used until a PTY reports usable dimensions. */
const FALLBACK_COLUMNS = 80
const FALLBACK_ROWS = 24

/** Terminal dimensions, kept current across resize events. */
export interface TerminalSize {
  readonly columns: number
  readonly rows: number
}

/**
 * Track the active stdout's dimensions.
 * @returns the current columns and rows, with 80×24 before the first resize.
 */
export function useTerminalSize(): TerminalSize {
  const { stdout } = useStdout()
  const [size, setSize] = useState<TerminalSize>({
    columns: stdout.columns > 0 ? stdout.columns : FALLBACK_COLUMNS,
    rows: stdout.rows > 0 ? stdout.rows : FALLBACK_ROWS,
  })
  useEffect(() => {
    const update = (): void => {
      setSize({
        columns: stdout.columns > 0 ? stdout.columns : FALLBACK_COLUMNS,
        rows: stdout.rows > 0 ? stdout.rows : FALLBACK_ROWS,
      })
    }
    update()
    stdout.on('resize', update)
    return () => { stdout.off('resize', update) }
  }, [stdout])
  return size
}
