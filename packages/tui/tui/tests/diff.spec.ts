import { describe, expect, it } from 'vitest'
import { computeDiff } from '../src/diff.ts'

describe('computeDiff', () => {
  it('returns no hunks for equal content', () => {
    expect(computeDiff('a\nb', 'a\nb', 3, 100)).toEqual([])
  })

  it('numbers one changed line with surrounding context', () => {
    expect(computeDiff('a\nb\nc', 'a\nx\nc', 1, 100)).toEqual([{
      oldStart: 1,
      newStart: 1,
      lines: [
        { kind: 'context', oldNumber: 1, newNumber: 1, text: 'a' },
        { kind: 'removed', oldNumber: 2, newNumber: undefined, text: 'b' },
        { kind: 'added', oldNumber: undefined, newNumber: 2, text: 'x' },
        { kind: 'context', oldNumber: 3, newNumber: 3, text: 'c' },
      ],
    }])
  })

  it('treats null prior content as a created file', () => {
    expect(computeDiff(null, 'x\ny', 3, 100)).toEqual([{
      oldStart: 1,
      newStart: 1,
      lines: [
        { kind: 'added', oldNumber: undefined, newNumber: 1, text: 'x' },
        { kind: 'added', oldNumber: undefined, newNumber: 2, text: 'y' },
      ],
    }])
  })

  it('splits distant changes into separate hunks', () => {
    const oldText = Array.from({ length: 20 }, (_, index) => `line ${String(index)}`).join('\n')
    const newText = oldText.replace('line 2', 'changed 2').replace('line 17', 'changed 17')
    const hunks = computeDiff(oldText, newText, 1, 100)
    expect(hunks).toHaveLength(2)
    expect(hunks[0]?.lines.map(line => line.kind)).toEqual(['context', 'removed', 'added', 'context'])
  })

  it('returns no hunk for two empty texts', () => {
    expect(computeDiff('', '', 3, 100)).toEqual([])
  })

  it('degrades a matrix over the cell budget even when line counts fit', () => {
    const hunks = computeDiff('a\nb\nc', 'x\ny\nz', 3, 3)
    expect(hunks).toHaveLength(1)
    expect(hunks[0]?.lines.map(line => line.kind)).toEqual([
      'removed', 'removed', 'removed', 'added', 'added', 'added',
    ])
  })

  it('ignores one trailing newline per side', () => {
    expect(computeDiff('a\n', 'a\nb\n', 3, 100)).toEqual([{
      oldStart: 1,
      newStart: 1,
      lines: [
        { kind: 'context', oldNumber: 1, newNumber: 1, text: 'a' },
        { kind: 'added', oldNumber: undefined, newNumber: 2, text: 'b' },
      ],
    }])
  })

  it('keeps trailing removals after the common prefix', () => {
    expect(computeDiff('a\nb', 'a', 3, 100)).toEqual([{
      oldStart: 1,
      newStart: 1,
      lines: [
        { kind: 'context', oldNumber: 1, newNumber: 1, text: 'a' },
        { kind: 'removed', oldNumber: 2, newNumber: undefined, text: 'b' },
      ],
    }])
  })

  it('degrades oversized input to a whole-file replacement', () => {
    const hunks = computeDiff('a\nb', 'a\nb\nc', 3, 1)
    expect(hunks).toHaveLength(1)
    expect(hunks[0]?.lines.map(line => line.kind)).toEqual(['removed', 'removed', 'added', 'added', 'added'])
  })
})
