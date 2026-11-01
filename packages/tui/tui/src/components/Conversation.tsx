/**
 * Scrollable conversation viewport. Content is bottom-aligned and clipped to
 * the rows left by the header, prompt, composer, and status bar; PageUp and
 * PageDown move the retained window by whole transcript entries.
 * @module @deepseek-ai/dsh-tui/components/Conversation
 */

import * as React from 'react'
import { Box, Text } from 'ink'
import { resultPreview } from '../tool-view.ts'
import { symbols, theme } from '../theme.ts'
import type { TuiConfig, TuiSnapshot, TuiStreamingView } from '../types.ts'
import { Banner } from './Banner.tsx'
import { Markdown } from './Markdown.tsx'
import { Message } from './Message.tsx'

function Streaming({ streaming, showThinking, config }: {
  readonly streaming: TuiStreamingView
  readonly showThinking: boolean
  readonly config: TuiConfig
}) {
  const reasoning = streaming.reasoning === ''
    ? undefined
    : resultPreview(streaming.reasoning, Math.max(2, config.toolOutputLines))
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold color={theme.accent}>{`${symbols.assistant} DSH`}</Text>
      {reasoning === undefined ? null : showThinking ? (
        <Box flexDirection="column" marginLeft={2}>
          {reasoning.lines.map((line, index) => (
            <Text key={index} color={theme.muted} wrap="truncate-end">{line === '' ? ' ' : line}</Text>
          ))}
          {reasoning.hidden === 0 ? null : (
            <Text color={theme.muted}>{`… ${String(reasoning.hidden)} more line(s)`}</Text>
          )}
        </Box>
      ) : (
        <Text color={theme.muted}>{`${symbols.thinking} thinking (${String(streaming.reasoning.length)} chars)`}</Text>
      )}
      {streaming.text === '' ? null : <Markdown text={streaming.text} />}
      {streaming.text === '' && streaming.reasoning === '' ? (
        <Text color={theme.muted}>{`${symbols.running} working…`}</Text>
      ) : null}
    </Box>
  )
}

/**
 * Render the conversation viewport.
 * @param props.snapshot - transcript and live stream.
 * @param props.showThinking - whether reasoning blocks are expanded.
 * @param props.scrollBack - transcript entries hidden below the window.
 * @param props.height - available rows.
 * @param props.columns - terminal width used to size the empty-state banner.
 * @param props.config - display bounds.
 */
export function Conversation({ snapshot, showThinking, scrollBack, height, columns, config }: {
  readonly snapshot: TuiSnapshot
  readonly showThinking: boolean
  readonly scrollBack: number
  readonly height: number
  readonly columns: number
  readonly config: TuiConfig
}) {
  const messages = snapshot.transcript.slice(0, Math.max(0, snapshot.transcript.length - scrollBack))
  const streaming = scrollBack === 0 ? snapshot.streaming : undefined
  const empty = messages.length === 0 && streaming === undefined
  return (
    <Box
      flexDirection="column"
      height={height}
      overflowY="hidden"
      justifyContent={empty ? 'center' : 'flex-end'}
      flexShrink={1}
    >
      {empty ? <Banner columns={columns} /> : null}
      {messages.map(message => (
        <Box key={message.id} flexShrink={0}>
          <Message message={message} showThinking={showThinking} config={config} />
        </Box>
      ))}
      {streaming === undefined ? null : (
        <Box flexShrink={0}>
          <Streaming streaming={streaming} showThinking={showThinking} config={config} />
        </Box>
      )}
    </Box>
  )
}
