/**
 * Bottom status row: directory, token accounting, and Agent lifecycle.
 * @module @deepseek-ai/dsh-tui/components/StatusBar
 */

import * as React from 'react'
import { homedir } from 'node:os'
import { Box, Text } from 'ink'
import { contextPercent, formatTokens } from '../commands.ts'
import { symbols, theme } from '../theme.ts'
import type { TuiSnapshot } from '../types.ts'

const LABEL: Record<TuiSnapshot['status'], { text: string; color: string }> = {
  starting: { text: 'starting', color: theme.warning },
  idle: { text: 'ready', color: 'green' },
  running: { text: 'working', color: theme.accent },
  stopped: { text: 'stopped', color: theme.muted },
}

function shortenDirectory(path: string): string {
  const home = homedir()
  return home !== '' && path.startsWith(home) ? `~${path.slice(home.length)}` : path
}

/**
 * Render the status row.
 * @param props.snapshot - current surface state.
 * @param props.scrollBack - number of transcript entries hidden above the viewport.
 */
export function StatusBar({ snapshot, scrollBack }: {
  readonly snapshot: TuiSnapshot
  readonly scrollBack: number
}) {
  const status = LABEL[snapshot.status]
  const context = snapshot.contextWindow === undefined
    ? `${formatTokens(snapshot.contextTokens)} tok`
    : `${formatTokens(snapshot.contextTokens)}/${formatTokens(snapshot.contextWindow)} ${String(contextPercent(snapshot.contextTokens, snapshot.contextWindow))}%`
  return (
    <Box justifyContent="space-between" paddingX={1} flexShrink={0}>
      <Text color={theme.muted} wrap="truncate-end">
        {shortenDirectory(snapshot.cwd)}
        {scrollBack > 0 ? `  ↑${String(scrollBack)}` : ''}
      </Text>
      <Text color={theme.muted} wrap="truncate-end">
        {`${context} · ${snapshot.reasoningEffort ?? 'default'}  `}
        <Text color={status.color}>{`${snapshot.status === 'running' ? symbols.running : ''}${status.text}`}</Text>
      </Text>
    </Box>
  )
}
