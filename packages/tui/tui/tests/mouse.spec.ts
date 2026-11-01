import { describe, expect, it } from 'vitest'
import { isMouseInput, parseMouseWheel } from '../src/mouse.ts'

describe('parseMouseWheel', () => {
  it('decodes up and down notches', () => {
    expect(parseMouseWheel('\x1b[<64;10;5M')).toEqual({ wheel: [-1], rest: '' })
    expect(parseMouseWheel('\x1b[<65;10;5M')).toEqual({ wheel: [1], rest: '' })
  })

  it('decodes several reports in one chunk', () => {
    expect(parseMouseWheel('\x1b[<64;1;1M\x1b[<65;2;2M')).toEqual({ wheel: [-1, 1], rest: '' })
  })

  it('retains a partial sequence for the next chunk', () => {
    const first = parseMouseWheel('\x1b[<64;10')
    expect(first.wheel).toEqual([])
    expect(first.rest).toBe('\x1b[<64;10')
    expect(parseMouseWheel(`${first.rest};5M`)).toEqual({ wheel: [-1], rest: '' })
  })

  it('ignores non-wheel buttons, release reports, and ordinary text', () => {
    expect(parseMouseWheel('\x1b[<0;1;1M')).toEqual({ wheel: [], rest: '' })
    expect(parseMouseWheel('\x1b[<64;1;1m')).toEqual({ wheel: [], rest: '' })
    expect(parseMouseWheel('hello')).toEqual({ wheel: [], rest: 'hello' })
  })

  it('bounds the unconsumed tail', () => {
    const parsed = parseMouseWheel('x'.repeat(100))
    expect(parsed.wheel).toEqual([])
    expect(parsed.rest).toHaveLength(64)
  })
})

describe('isMouseInput', () => {
  it('recognizes raw and Ink-parsed mouse reports', () => {
    expect(isMouseInput('\x1b[<64;1;1M')).toBe(true)
    expect(isMouseInput('[<64;1;1M')).toBe(true)
    expect(isMouseInput('<65;1;1M')).toBe(true)
    expect(isMouseInput('/help')).toBe(false)
    expect(isMouseInput('')).toBe(false)
  })
})
