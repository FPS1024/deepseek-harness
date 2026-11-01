/**
 * One tool-call card: status, salient arguments, truncated result, and any
 * recorded file diff.
 * @module @deepseek-ai/dsh-tui/components/ToolCall
 */

import * as React from 'react'
import { Box, Text } from 'ink'
import { theme, symbols } from '../theme.ts'
import { resultPreview, resultTail, summarizeToolCall } from '../tool-view.ts'
import type { TuiConfig, TuiToolBlock, TuiToolStatus } from '../types.ts'
import { DiffView } from './DiffView.tsx'

const STATUS: Record<TuiToolStatus, { glyph: string; color: string; label: string }> = {
  pending: { glyph: symbols.pending, color: theme.warning, label: 'running' },
  success: { glyph: symbols.success, color: 'green', label: 'completed' },
  error: { glyph: symbols.error, color: theme.error, label: 'failed' },
  cancelled: { glyph: symbols.cancelled, color: theme.muted, label: 'cancelled' },
}

/**
 * Render one tool invocation.
 * @param props.block - recorded call, status, result, and optional diffs.
 * @param props.config - output and diff display bounds.
 */
export function ToolCall({ block, config }: {
  readonly block: TuiToolBlock
  readonly config: TuiConfig
}) {
  const status = STATUS[block.status]
  const summary = summarizeToolCall(block.name, block.input)
  const output = block.output === undefined
    ? undefined
    : block.status === 'pending'
      ? resultTail(block.output, config.toolOutputLines)
      : resultPreview(block.output, config.toolOutputLines)
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text wrap="truncate-end">
        <Text color={status.color}>{status.glyph}</Text>
        {' '}
        <Text bold>{block.name}</Text>
        {' '}
        <Text color={theme.muted}>{status.label}</Text>
      </Text>
      {summary.command === undefined ? null : (
        <Text wrap="truncate-end">
          <Text color={theme.muted}>{'  $ '}</Text>
          {summary.command}
        </Text>
      )}
      {summary.command === undefined && summary.path !== undefined ? (
        <Text wrap="truncate-end">
          <Text color={theme.muted}>{'  '}</Text>
          {summary.path}
        </Text>
      ) : null}
      {summary.command === undefined && summary.path === undefined && summary.detail !== '' ? (
        <Text color={theme.muted} wrap="truncate-end">{`  ${summary.detail}`}</Text>
      ) : null}
      {output === undefined || output.lines.length === 0 ? null : (
        <Box flexDirection="column" marginLeft={2}>
          {output.lines.map((line, index) => (
            <Text key={index} wrap="truncate-end">{line === '' ? ' ' : line}</Text>
          ))}
          {output.hidden === 0 ? null : (
            <Text color={theme.muted}>{`… ${String(output.hidden)} more line(s)`}</Text>
          )}
        </Box>
      )}
      {block.error === undefined ? null : (
        <Text color={theme.error} wrap="truncate-end">{`  ${symbols.error} ${block.error}`}</Text>
      )}
      {block.diffs === undefined ? null : (
        <DiffView diffs={block.diffs} context={config.diffContextLines} maxLines={config.diffMaxLines} />
      )}
    </Box>
  )
}
