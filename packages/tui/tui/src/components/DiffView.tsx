/**
 * Inline file-change cards for tool results that carry before/after text.
 * @module @deepseek-ai/dsh-tui/components/DiffView
 */

import * as React from 'react'
import { Box, Text } from 'ink'
import { computeDiff, diffHunkHeader, type DiffLine } from '../diff.ts'
import { theme } from '../theme.ts'
import type { TuiFileDiff } from '../types.ts'

function Line({ line }: { readonly line: DiffLine }) {
  if (line.kind === 'removed') {
    return (
      <Text color={theme.diffRemoved} wrap="truncate-end">
        {`- ${String(line.oldNumber ?? '').padStart(4)} ${line.text}`}
      </Text>
    )
  }
  if (line.kind === 'added') {
    return (
      <Text color={theme.diffAdded} wrap="truncate-end">
        {`+ ${String(line.newNumber ?? '').padStart(4)} ${line.text}`}
      </Text>
    )
  }
  return (
    <Text wrap="truncate-end">
      {`  ${String(line.oldNumber ?? '').padStart(4)} ${line.text}`}
    </Text>
  )
}

/**
 * Render every diff attached to one tool result.
 * @param props.diffs - validated file diffs from result metadata.
 * @param props.context - unchanged lines kept around each change.
 * @param props.maxLines - per-side line ceiling before whole-file degradation.
 */
export function DiffView({ diffs, context, maxLines }: {
  readonly diffs: readonly TuiFileDiff[]
  readonly context: number
  readonly maxLines: number
}) {
  return (
    <Box flexDirection="column" marginTop={1}>
      {diffs.map((diff, index) => {
        const hunks = computeDiff(diff.oldText, diff.newText, context, maxLines)
        return (
          <Box key={`${diff.path}-${String(index)}`} flexDirection="column">
            <Text bold color="blue" wrap="truncate-end">{diff.path}</Text>
            {hunks.length === 0
              ? <Text color={theme.muted}>(no changes)</Text>
              : hunks.map((hunk, hunkIndex) => (
                <Box key={`hunk-${String(hunkIndex)}`} flexDirection="column">
                  <Text color={theme.muted}>{diffHunkHeader(hunk)}</Text>
                  {hunk.lines.map((line, lineIndex) => <Line key={lineIndex} line={line} />)}
                </Box>
              ))}
          </Box>
        )
      })}
    </Box>
  )
}
