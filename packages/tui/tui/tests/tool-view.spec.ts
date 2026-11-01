import { describe, expect, it } from 'vitest'
import { parseArguments, resultPreview, resultTail, summarizeToolCall, toolErrorText } from '../src/tool-view.ts'

describe('parseArguments', () => {
  it('parses JSON and rejects empty or malformed text', () => {
    expect(parseArguments('{"a":1}')).toEqual({ a: 1 })
    expect(parseArguments('')).toBeUndefined()
    expect(parseArguments('not json')).toBeUndefined()
  })
})

describe('summarizeToolCall', () => {
  it('extracts a command or path', () => {
    expect(summarizeToolCall('bash', '{"command":"ls -la"}')).toEqual({ command: 'ls -la', detail: '' })
    expect(summarizeToolCall('read', '{"file_path":"a.txt"}')).toEqual({ path: 'a.txt', detail: '' })
  })

  it('uses the first non-empty candidate and falls back to compact JSON', () => {
    expect(summarizeToolCall('read', '{"path":"","filePath":"b.txt"}')).toEqual({ path: 'b.txt', detail: '' })
    expect(summarizeToolCall('other', '{"query":"needle"}')).toEqual({ detail: '{"query":"needle"}' })
  })

  it('shows the first line of run_code', () => {
    expect(summarizeToolCall('run_code', '{"code":"const a = 1\\nconst b = 2"}')).toEqual({ detail: 'const a = 1' })
  })

  it('truncates long details', () => {
    const summary = summarizeToolCall('other', JSON.stringify({ value: 'x'.repeat(400) }))
    expect(summary.detail.endsWith('…')).toBe(true)
    expect(summary.detail.length).toBe(240)
  })

  it('handles empty and unparsable arguments', () => {
    expect(summarizeToolCall('other', '')).toEqual({ detail: '' })
    expect(summarizeToolCall('other', 'raw text')).toEqual({ detail: 'raw text' })
  })
})

describe('resultPreview', () => {
  it('retains up to the limit and counts hidden lines', () => {
    expect(resultPreview('a\nb\nc', 2)).toEqual({ lines: ['a', 'b'], hidden: 1 })
    expect(resultPreview('a\nb\n', 5)).toEqual({ lines: ['a', 'b'], hidden: 0 })
    expect(resultPreview('a', 0)).toEqual({ lines: [], hidden: 1 })
    expect(resultPreview('', 0)).toEqual({ lines: [], hidden: 0 })
  })
})

describe('resultTail', () => {
  it('retains the newest limit lines and counts hidden lines', () => {
    expect(resultTail('a\nb\nc', 2)).toEqual({ lines: ['b', 'c'], hidden: 1 })
    expect(resultTail('a\nb\n', 5)).toEqual({ lines: ['a', 'b'], hidden: 0 })
    expect(resultTail('a\nb', 0)).toEqual({ lines: [], hidden: 2 })
    expect(resultTail('', 0)).toEqual({ lines: [], hidden: 0 })
  })
})

describe('toolErrorText', () => {
  it('prefers the reason, then the code, then a generic label', () => {
    expect(toolErrorText('CODE', 'reason')).toBe('reason')
    expect(toolErrorText('CODE', '')).toBe('CODE')
    expect(toolErrorText(undefined, undefined)).toBe('tool failed')
  })
})

describe('tool-view missing fields', () => {
  it('falls back to compact JSON when run_code carries no code', () => {
    expect(summarizeToolCall('run_code', '{"other":1}')).toEqual({ detail: '{"other":1}' })
  })

  it('handles a code line without another newline', () => {
    expect(summarizeToolCall('run_code', '{"code":"only"}')).toEqual({ detail: 'only' })
  })
})
