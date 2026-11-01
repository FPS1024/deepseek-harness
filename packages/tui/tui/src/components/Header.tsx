/**
 * Terminal header: product name, session route, and a divider.
 * @module @deepseek-ai/dsh-tui/components/Header
 */

import * as React from 'react'
import { Box, Text } from 'ink'
import { theme, symbols } from '../theme.ts'

/**
 * Render the fixed header.
 * @param props.model - active model id.
 * @param props.provider - active provider route.
 * @param props.reasoningEffort - selected reasoning effort, absent for the provider default.
 * @param props.columns - terminal width used for the divider.
 */
export function Header({ model, provider, reasoningEffort, columns }: {
  readonly model: string
  readonly provider: string
  readonly reasoningEffort: string | undefined
  readonly columns: number
}) {
  const route = model === '' ? '' : provider === '' ? model : `${provider}/${model}`
  const label = route === '' ? '' : `${route} · ${reasoningEffort ?? 'default'}`
  return (
    <Box flexDirection="column" flexShrink={0}>
      <Box justifyContent="space-between" paddingX={1}>
        <Text bold color={theme.accent}>DSH</Text>
        <Text color={theme.muted} wrap="truncate-end">{label}</Text>
      </Box>
      <Text color={theme.muted}>{symbols.rule.repeat(Math.max(1, columns))}</Text>
    </Box>
  )
}
