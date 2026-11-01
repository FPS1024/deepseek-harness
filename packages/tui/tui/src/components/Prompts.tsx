/**
 * Approval and question panels. Keys are handled by the App so one owner
 * decides whether input belongs to a prompt or the composer.
 * @module @deepseek-ai/dsh-tui/components/Prompts
 */

import * as React from 'react'
import { Box, Text } from 'ink'
import { resultPreview } from '../tool-view.ts'
import { symbols, theme } from '../theme.ts'
import type { TuiConfig, TuiPermissionView, TuiQuestionView } from '../types.ts'

/**
 * Render one pending approval.
 * @param props.permission - tool, reason, and bounded call detail awaiting a decision.
 */
export function PermissionPrompt({ permission }: { readonly permission: TuiPermissionView }) {
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.permission}
      paddingX={1}
      flexShrink={0}
    >
      <Text bold color={theme.permission}>{`${symbols.permission} Permission required`}</Text>
      <Text wrap="wrap">
        {'Agent wants to use '}
        <Text bold>{permission.toolName}</Text>
        {'.'}
      </Text>
      {permission.reason === undefined ? null : (
        <Text color={theme.muted} wrap="wrap">{permission.reason}</Text>
      )}
      {permission.title === undefined ? null : (
        <Text bold wrap="truncate-end">{permission.title}</Text>
      )}
      {permission.description === undefined ? null : (
        <Text color={theme.muted} wrap="truncate-end">{permission.description}</Text>
      )}
      {permission.command === undefined ? null : (
        <Text wrap="truncate-end">
          <Text color={theme.muted}>{'$ '}</Text>
          {permission.command}
        </Text>
      )}
      {permission.cwd === undefined ? null : (
        <Text color={theme.muted} wrap="truncate-end">{`in ${permission.cwd}`}</Text>
      )}
      {permission.details?.map((detail, index) => (
        <Text
          key={`${detail.kind}-${String(index)}`}
          color={detail.kind === 'path' ? 'blue'
            : detail.kind === 'added' ? theme.diffAdded
              : detail.kind === 'removed' ? theme.diffRemoved : theme.muted}
          wrap="truncate-end"
        >
          {detail.text}
        </Text>
      ))}
      <Text>
        <Text color="green">[y]</Text>
        {' Allow once   '}
        <Text color={theme.error}>[n]</Text>
        {' Deny'}
      </Text>
    </Box>
  )
}

/**
 * Render one pending user-questions batch.
 * @param props.question - current batch and accumulated answers.
 * @param props.config - detail-line bound.
 */
export function QuestionPrompt({ question, config }: {
  readonly question: TuiQuestionView
  readonly config: TuiConfig
}) {
  const active = question.questions[question.active]
  const custom = active === undefined ? '' : question.custom[active.id] ?? ''
  const detail = active?.detail === undefined || active.detail === ''
    ? undefined
    : resultPreview(active.detail, Math.max(4, config.toolOutputLines))
  const options = active?.options ?? []
  const activeId = active?.id ?? ''
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.accent}
      paddingX={1}
      flexShrink={0}
    >
      <Text bold color={theme.accent}>
        {question.questions.length > 1
          ? `${symbols.permission} Question ${String(question.active + 1)}/${String(question.questions.length)}`
          : `${symbols.permission} Question`}
      </Text>
      {active === undefined ? null : <Text wrap="wrap">{active.question}</Text>}
      {detail === undefined ? null : (
        <Box flexDirection="column" marginLeft={2}>
          {detail.lines.map((line, index) => (
            <Text key={index} color={theme.muted} wrap="truncate-end">{line === '' ? ' ' : line}</Text>
          ))}
          {detail.hidden === 0 ? null : (
            <Text color={theme.muted}>{`… ${String(detail.hidden)} more line(s)`}</Text>
          )}
        </Box>
      )}
      {options.length === 0 ? null : (
        <Box flexDirection="column" marginTop={1}>
          {options.map((option, index) => {
            const chosen = (question.selected[activeId] ?? []).includes(option.label)
            return (
              <Text key={option.label} wrap="wrap">
                <Text color={theme.muted}>{`  ${String(index + 1)}. `}</Text>
                <Text color={chosen ? 'green' : theme.assistant}>{chosen ? '[x] ' : '[ ] '}</Text>
                {option.label}
                {option.description === undefined ? null : (
                  <Text color={theme.muted}>{` — ${option.description}`}</Text>
                )}
              </Text>
            )
          })}
        </Box>
      )}
      <Text wrap="truncate-end">
        <Text color={theme.muted}>Other: </Text>
        {custom === '' ? <Text color={theme.muted}>(type to answer)</Text> : custom}
      </Text>
      <Text color={theme.muted} wrap="truncate-end">
        1–9 select · Enter submit · ←/→ question · ^C cancel turn
      </Text>
    </Box>
  )
}
