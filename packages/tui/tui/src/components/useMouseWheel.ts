/**
 * Terminal mouse-wheel hook. It enables SGR wheel reporting on the process TTY
 * and forwards decoded notches to the caller; other streams (tests, embedded
 * hosts) never enter mouse mode.
 * @module @deepseek-ai/dsh-tui/components/useMouseWheel
 */

import { useStdin, useStdout } from 'ink'
import { useEffect, useRef } from 'react'
import { parseMouseWheel } from '../mouse.ts'

/**
 * Subscribe to terminal wheel notches.
 * @param onWheel - receives -1 for one notch up and +1 for one notch down.
 */
export function useMouseWheel(onWheel: (delta: number) => void): void {
  const { stdin } = useStdin()
  const { stdout } = useStdout()
  const handler = useRef(onWheel)
  handler.current = onWheel
  useEffect(() => {
    if (stdout !== process.stdout || stdin !== process.stdin || !stdout.isTTY) return
    let pending = ''
    const onData = (chunk: Buffer | string): void => {
      const parsed = parseMouseWheel(pending + chunk.toString())
      pending = parsed.rest
      for (const delta of parsed.wheel) handler.current(delta)
    }
    stdout.write('\x1b[?1000h\x1b[?1006h')
    stdin.on('data', onData)
    return () => {
      stdin.off('data', onData)
      stdout.write('\x1b[?1006l\x1b[?1000l')
    }
  }, [stdin, stdout])
}
