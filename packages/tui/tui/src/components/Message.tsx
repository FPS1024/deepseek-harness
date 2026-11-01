/**
 * One transcript entry: user prompt, assistant blocks, or a terminal notice.
 * @module @deepseek-ai/dsh-tui/components/Message
 */

import * as React from 'react'
import { Box, Text } from 'ink'
import { assertNever } from '@deepseek-ai/dsh-util-values'
import { symbols, theme } from '../theme.ts'
import { resultPreview } from '../tool-view.ts'
import type { TuiAssistantBlock, TuiConfig, TuiTranscriptMessage } from '../types.ts'
import { Markdown } from './Markdown.tsx'
import { ToolCall } from './ToolCall.tsx'

function Reasoning({ text, expanded, config }: {
  readonly text: string
  readonly expanded: boolean
  readonly config: TuiConfig
}) {
  if (!expanded) {
    return (
      <Box marginTop={1}>
        <Text color={theme.muted}>
          {`${symbols.thinking} thinking (${String(text.length)} chars) — Ctrl+T to expand`}
        </Text>
      </Box>
    )
  }
  const preview = resultPreview(text, Math.max(4, config.toolOutputLines * 2))
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color={theme.muted}>{`${symbols.thinking} thinking`}</Text>
      <Box flexDirection="column" marginLeft={2}>
        {preview.lines.map((line, index) => (
          <Text key={index} color={theme.muted} wrap="truncate-end">{line === '' ? ' ' : line}</Text>
        ))}
        {preview.hidden === 0 ? null : (
          <Text color={theme.muted}>{`… ${String(preview.hidden)} more line(s)`}</Text>
        )}
      </Box>
    </Box>
  )
}

function AssistantBlock({ block, showThinking, config }: {
  readonly block: TuiAssistantBlock
  readonly showThinking: boolean
  readonly config: TuiConfig
}) {
  switch (block.type) {
    case 'text': return <Markdown text={block.text} />
    case 'reasoning': return <Reasoning text={block.text} expanded={showThinking} config={config} />
    case 'tool': return <ToolCall block={block} config={config} />
    default: return assertNever(block, 'assistant block')
  }
}

/**
 * Render one transcript entry.
 * @param props.message - stored entry.
 * @param props.showThinking - whether reasoning blocks are expanded.
 * @param props.config - display bounds.
 */
export function Message({ message, showThinking, config }: {
  readonly message: TuiTranscriptMessage
  readonly showThinking: boolean
  readonly config: TuiConfig
}) {
  if (message.role === 'system') {
    return (
      <Box marginTop={1}>
        <Text color={message.kind === 'error' ? theme.error : theme.muted} wrap="wrap">
          {message.kind === 'error' ? `${symbols.error} ` : `${symbols.bullet} `}
          {message.text}
        </Text>
      </Box>
    )
  }
  if (message.role === 'user') {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text bold color={theme.user}>{`${symbols.user} You`}</Text>
        <Text wrap="wrap">{message.text}</Text>
      </Box>
    )
  }
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold color={theme.accent}>{`${symbols.assistant} DSH`}</Text>
      {message.blocks.map((block, index) => (
        <AssistantBlock key={index} block={block} showThinking={showThinking} config={config} />
      ))}
    </Box>
  )
}
