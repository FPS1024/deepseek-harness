/**
 * Two-step `/model` picker: choose a model, then its reasoning effort. Keys are
 * handled by the App so the picker and the composer never compete for input.
 * @module @deepseek-ai/dsh-tui/components/ModelPicker
 */

import * as React from 'react'
import { Box, Text } from 'ink'
import { symbols, theme } from '../theme.ts'
import type { TuiModelPicker } from '../types.ts'

/** Rows shown at once for the model step. */
export const MODEL_WINDOW = 10

/**
 * Render the pending model or effort chooser.
 * @param props.picker - current step, rows, and highlighted index.
 * @param props.provider - active provider route, used to mark the current model.
 * @param props.model - active model id, used to mark the current model.
 * @param props.effort - active reasoning effort, absent for the provider default.
 */
export function ModelPicker({ picker, provider, model, effort }: {
  readonly picker: TuiModelPicker
  readonly provider: string
  readonly model: string
  readonly effort: string | undefined
}) {
  if (picker.step === 'effort') {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={theme.accent} paddingX={1} flexShrink={0}>
        <Box justifyContent="space-between">
          <Text bold color={theme.accent}>{`${symbols.permission} Reasoning effort`}</Text>
          <Text color={theme.muted}>{`${picker.provider}/${picker.model}`}</Text>
        </Box>
        {picker.efforts.map((choice, index) => {
          const selected = index === picker.index
          const current = (effort ?? '') === choice.id
          return (
            <Text key={choice.id === '' ? 'default' : choice.id} wrap="truncate-end">
              <Text color={selected ? theme.accent : theme.muted}>{selected ? '› ' : '  '}</Text>
              <Text color={selected ? theme.accent : theme.assistant} bold={selected}>{choice.name}</Text>
              {current ? <Text color="green">{'  ● current'}</Text> : null}
            </Text>
          )
        })}
        <Text color={theme.muted} wrap="truncate-end">Enter apply · ↑↓ move · Esc cancel</Text>
      </Box>
    )
  }

  const start = Math.max(0, Math.min(picker.index - Math.floor(MODEL_WINDOW / 2), picker.models.length - MODEL_WINDOW))
  const visible = picker.models.slice(start, start + MODEL_WINDOW)
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.accent} paddingX={1} flexShrink={0}>
      <Box justifyContent="space-between">
        <Text bold color={theme.accent}>{`${symbols.permission} Select model`}</Text>
        <Text color={theme.muted}>{`${String(picker.index + 1)}/${String(picker.models.length)}`}</Text>
      </Box>
      {visible.map((choice, offset) => {
        const index = start + offset
        const selected = index === picker.index
        const current = choice.provider === provider && choice.model === model
        return (
          <Text key={`${choice.provider}/${choice.model}`} wrap="truncate-end">
            <Text color={selected ? theme.accent : theme.muted}>{selected ? '› ' : '  '}</Text>
            <Text color={selected ? theme.accent : theme.assistant} bold={selected}>
              {`${choice.provider}/${choice.model}`}
            </Text>
            <Text color={theme.muted}>{`  ${choice.name}`}</Text>
            {choice.description === undefined ? null : <Text color={theme.muted}>{` — ${choice.description}`}</Text>}
            {current ? <Text color="green">{'  ● current'}</Text> : null}
          </Text>
        )
      })}
      <Text color={theme.muted} wrap="truncate-end">Enter select · ↑↓ move · Esc cancel</Text>
    </Box>
  )
}
