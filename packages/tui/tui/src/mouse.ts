/**
 * SGR mouse-wheel decoding for terminals that report wheel events. Terminals
 * encode a wheel notch as button 64 (up) or 65 (down); the hook enables the
 * reporting modes only for the process TTY.
 * @module @deepseek-ai/dsh-tui/mouse
 */

const SGR_MOUSE = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/g

/** Wheel deltas decoded from one input buffer. */
export interface MouseWheelParse {
  /** Signed notch deltas in arrival order: -1 up, +1 down. */
  readonly wheel: readonly number[]
  /** Unconsumed tail retained for a sequence split across chunks. */
  readonly rest: string
}

/**
 * Decode complete SGR mouse reports in one chunk.
 * @param data - accumulated input text.
 * @returns wheel deltas and the tail to prepend to the next chunk.
 */
export function parseMouseWheel(data: string): MouseWheelParse {
  const wheel: number[] = []
  let consumed = 0
  SGR_MOUSE.lastIndex = 0
  for (let match = SGR_MOUSE.exec(data); match !== null; match = SGR_MOUSE.exec(data)) {
    consumed = match.index + match[0].length
    if (match[4] !== 'M') continue
    const button = Number(match[1])
    if (button === 64) wheel.push(-1)
    else if (button === 65) wheel.push(1)
  }
  const rest = data.slice(consumed)
  return { wheel, rest: rest.length > 64 ? rest.slice(-64) : rest }
}

/**
 * Whether one Ink keypress string is part of a mouse report rather than text.
 * @param input - `useInput` input text.
 * @returns true when the string must not reach the composer.
 */
export function isMouseInput(input: string): boolean {
  return input.includes('\x1b[<') || /^\[?<\d+;\d+;\d+[Mm]$/.test(input)
}
