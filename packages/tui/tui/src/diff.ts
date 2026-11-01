/**
 * Line-oriented diff production for file-change cards. The algorithm is a
 * bounded longest-common-subsequence walk; an oversized file degrades to one
 * whole-file replacement so a pathological result cannot stall rendering.
 * @module @deepseek-ai/dsh-tui/diff
 */

/** One numbered line in a rendered diff. */
export interface DiffLine {
  readonly kind: 'context' | 'added' | 'removed'
  readonly oldNumber: number | undefined
  readonly newNumber: number | undefined
  readonly text: string
}

/** One contiguous change window with surrounding context. */
export interface DiffHunk {
  readonly oldStart: number
  readonly newStart: number
  readonly lines: readonly DiffLine[]
}

interface Operation {
  readonly kind: 'equal' | 'added' | 'removed'
  readonly text: string
}

function splitLines(text: string): string[] {
  const normalized = text.replaceAll('\r\n', '\n').replaceAll('\r', '\n')
  if (normalized === '') return []
  const lines = normalized.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  return lines
}

function wholeFile(oldLines: readonly string[], newLines: readonly string[]): Operation[] {
  return [
    ...oldLines.map(text => ({ kind: 'removed' as const, text })),
    ...newLines.map(text => ({ kind: 'added' as const, text })),
  ]
}

function lineAt(lines: readonly string[], index: number): string {
  /* v8 ignore next -- callers index within the array length */
  return lines[index] ?? ''
}

function operations(oldLines: readonly string[], newLines: readonly string[], maxLines: number): Operation[] {
  if (oldLines.length > maxLines || newLines.length > maxLines) return wholeFile(oldLines, newLines)
  const rows = oldLines.length + 1
  const columns = newLines.length + 1
  if (rows * columns > maxLines * maxLines) return wholeFile(oldLines, newLines)
  const table = new Uint32Array(rows * columns)
  const cell = (row: number, column: number): number => {
    /* v8 ignore next -- every read is inside the constructed matrix */
    return table[row * columns + column] ?? 0
  }
  for (let i = oldLines.length - 1; i >= 0; i--) {
    for (let j = newLines.length - 1; j >= 0; j--) {
      table[i * columns + j] = lineAt(oldLines, i) === lineAt(newLines, j)
        ? cell(i + 1, j + 1) + 1
        : Math.max(cell(i + 1, j), cell(i, j + 1))
    }
  }
  const result: Operation[] = []
  let i = 0
  let j = 0
  while (i < oldLines.length && j < newLines.length) {
    if (lineAt(oldLines, i) === lineAt(newLines, j)) {
      result.push({ kind: 'equal', text: lineAt(oldLines, i) })
      i++
      j++
    } else if (cell(i + 1, j) >= cell(i, j + 1)) {
      result.push({ kind: 'removed', text: lineAt(oldLines, i) })
      i++
    } else {
      result.push({ kind: 'added', text: lineAt(newLines, j) })
      j++
    }
  }
  while (i < oldLines.length) { result.push({ kind: 'removed', text: lineAt(oldLines, i) }); i++ }
  while (j < newLines.length) { result.push({ kind: 'added', text: lineAt(newLines, j) }); j++ }
  return result
}

/**
 * Compute contextual hunks for one file change.
 * @param oldText - prior content, or null for a created file.
 * @param newText - content after the change.
 * @param context - unchanged lines retained around each change.
 * @param maxLines - per-side line ceiling before degrading to a whole-file diff.
 * @returns hunks in file order; empty when the contents are equal.
 */
export function computeDiff(
  oldText: string | null,
  newText: string,
  context: number,
  maxLines: number,
): readonly DiffHunk[] {
  const oldLines = oldText === null ? [] : splitLines(oldText)
  const newLines = splitLines(newText)
  const ops = operations(oldLines, newLines, maxLines)
  const changed = ops.some(op => op.kind !== 'equal')
  if (!changed) return []
  const keep = Math.max(0, context)
  const important = ops.map(op => op.kind !== 'equal')
  const included = important.map((value, index) => value
    || important.slice(Math.max(0, index - keep), index + keep + 1).some(Boolean))
  const hunks: DiffHunk[] = []
  let oldNumber = 1
  let newNumber = 1
  let current: { lines: DiffLine[]; oldStart: number; newStart: number } | undefined
  const flush = (): void => {
    if (current !== undefined) hunks.push(current)
    current = undefined
  }
  ops.forEach((op, index) => {
    if (included[index] !== true) {
      flush()
    } else if (current === undefined) {
      current = { lines: [], oldStart: oldNumber, newStart: newNumber }
    }
    if (op.kind === 'equal') {
      current?.lines.push({ kind: 'context', oldNumber, newNumber, text: op.text })
      oldNumber++
      newNumber++
    } else if (op.kind === 'removed') {
      current?.lines.push({ kind: 'removed', oldNumber, newNumber: undefined, text: op.text })
      oldNumber++
    } else {
      current?.lines.push({ kind: 'added', oldNumber: undefined, newNumber, text: op.text })
      newNumber++
    }
  })
  flush()
  return hunks
}

/**
 * Render one unified-diff hunk header.
 * @param hunk - contiguous change window.
 * @returns the `@@` header with old and new line counts.
 */
export function diffHunkHeader(hunk: DiffHunk): string {
  const oldCount = hunk.lines.filter(line => line.kind !== 'added').length
  const newCount = hunk.lines.filter(line => line.kind !== 'removed').length
  return `@@ -${String(hunk.oldStart)},${String(oldCount)} +${String(hunk.newStart)},${String(newCount)} @@`
}
