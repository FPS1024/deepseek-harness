/**
 * `/resume` session picker. Keys are handled by the App so the picker and the
 * composer never compete for input.
 * @module @deepseek-ai/dsh-tui/components/SessionPicker
 */

import * as React from 'react'
import { Box, Text } from 'ink'
import { filterSessionChoices } from '../state/state.ts'
import { symbols, theme } from '../theme.ts'
import type { TuiSessionPicker } from '../types.ts'

/** Rows shown at once; the window follows the highlight. */
const WINDOW = 8

function formatDate(ms: number): string {
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 16)
}

/**
 * Render the pending resume chooser with its id/title filter.
 * @param props.picker - resumable Sessions, typed filter, and the highlighted row.
 */
export function SessionPicker({ picker }: { readonly picker: TuiSessionPicker }) {
  const matches = filterSessionChoices(picker.sessions, picker.query)
  const start = Math.max(0, Math.min(picker.index - Math.floor(WINDOW / 2), matches.length - WINDOW))
  const visible = matches.slice(start, start + WINDOW)
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.accent}
      paddingX={1}
      flexShrink={0}
    >
      <Box justifyContent="space-between">
        <Text bold color={theme.accent}>{`${symbols.permission} Resume session`}</Text>
        <Text color={theme.muted}>{`${matches.length === 0 ? '0' : String(picker.index + 1)}/${String(matches.length)}`}</Text>
      </Box>
      <Text wrap="truncate-end">
        <Text color={theme.muted}>{'search '}</Text>
        <Text color={picker.query === '' ? theme.muted : theme.assistant}>
          {picker.query === '' ? 'title or id…' : picker.query}
        </Text>
      </Text>
      {visible.length === 0
        ? <Text color={theme.muted}>{'  No matching Sessions.'}</Text>
        : visible.map((session, offset) => {
          const index = start + offset
          const selected = index === picker.index
          const label = session.title ?? session.id
          return (
            <Text key={session.id} wrap="truncate-end">
              <Text color={selected ? theme.accent : theme.muted}>{selected ? '› ' : '  '}</Text>
              <Text color={selected ? theme.accent : theme.assistant} bold={selected}>{label}</Text>
              {session.title === undefined
                ? null
                : <Text color={theme.muted}>{`  ${session.id}`}</Text>}
              <Text color={theme.muted}>{`  ${formatDate(session.createdAt)}${session.live ? '  live' : ''}`}</Text>
            </Text>
          )
        })}
      <Text color={theme.muted} wrap="truncate-end">Enter resume · ↑↓ move · type to search · Esc cancel</Text>
    </Box>
  )
}
