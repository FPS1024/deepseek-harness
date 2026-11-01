/**
 * Fenced code rendering. The fence keeps its language label and truncates long
 * lines at the conversation width instead of wrapping them into unreadable
 * continuations.
 * @module @deepseek-ai/dsh-tui/components/CodeBlock
 */

import * as React from 'react'
import { Box, Text } from 'ink'
import { theme } from '../theme.ts'

/**
 * Render one fenced code block.
 * @param props.lang - fence language label, when supplied.
 * @param props.text - code body without the fences.
 */
export function CodeBlock({ lang, text }: { readonly lang: string; readonly text: string }) {
  const lines = text === '' ? [''] : text.split('\n')
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.muted} paddingX={1} marginTop={1}>
      {lang === '' ? null : <Text color={theme.muted}>{lang}</Text>}
      {lines.map((line, index) => (
        <Text key={index} wrap="truncate-end">
          {line === '' ? ' ' : line}
        </Text>
      ))}
    </Box>
  )
}
