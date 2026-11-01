/**
 * Multi-line composer with cursor editing, shell-style history, and slash
 * command prediction. Global interrupt and exit keys belong to the App so a
 * prompt cannot steal them.
 * @module @deepseek-ai/dsh-tui/components/Composer
 */

import * as React from 'react'
import { Box, Text, useInput } from 'ink'
import { useEffect, useState } from 'react'
import { isMouseInput } from '../mouse.ts'
import { theme } from '../theme.ts'
import type { TuiCommandInfo } from '../types.ts'

/** Commands shown at once above the input. */
const MAX_SUGGESTIONS = 6

function verticalCursor(value: string, cursor: number, direction: -1 | 1): number | undefined {
  const lineStart = value.lastIndexOf('\n', Math.max(0, cursor - 1)) + 1
  const column = cursor - lineStart
  if (direction < 0) {
    if (lineStart === 0) return undefined
    const previousStart = value.lastIndexOf('\n', lineStart - 2) + 1
    return Math.min(previousStart + column, lineStart - 1)
  }
  const lineEnd = value.indexOf('\n', cursor)
  if (lineEnd === -1) return undefined
  const nextStart = lineEnd + 1
  const nextEnd = value.indexOf('\n', nextStart)
  return Math.min(nextStart + column, nextEnd === -1 ? value.length : nextEnd)
}

/**
 * Render the composer, command prediction, and input history.
 * @param props.disabled - true while an approval, question, or picker owns input.
 * @param props.commands - slash commands with their explanations.
 * @param props.onSubmit - receives the complete text on Enter.
 * @param props.onSuggestionsChange - reports the rows the prediction list adds.
 * @param props.initialHistory - durable entries loaded before the composer mounted.
 * @param props.onRemember - records one submitted line in durable history.
 */
export function Composer({ disabled, commands, onSubmit, onSuggestionsChange, initialHistory, onRemember }: {
  readonly disabled: boolean
  readonly commands: readonly TuiCommandInfo[]
  readonly onSubmit: (text: string) => void
  readonly onSuggestionsChange?: ((rows: number) => void) | undefined
  readonly initialHistory?: readonly string[] | undefined
  readonly onRemember?: ((text: string) => void) | undefined
}) {
  const [value, setValue] = useState('')
  const [cursor, setCursor] = useState(0)
  const [history, setHistory] = useState<readonly string[]>(initialHistory ?? [])
  const [historyIndex, setHistoryIndex] = useState<number | null>(null)
  const [draft, setDraft] = useState('')
  const [dismissed, setDismissed] = useState(false)
  const [selected, setSelected] = useState(0)

  const query = value.startsWith('/') && !/\s/.test(value) ? value.slice(1).toLowerCase() : undefined
  const matches = query === undefined
    ? []
    : commands.filter(command => command.name.startsWith(query)).slice(0, MAX_SUGGESTIONS)
  const showing = matches.length > 0 && !dismissed

  useEffect(() => {
    if (cursor > value.length) setCursor(value.length)
  }, [cursor, value.length])

  useEffect(() => {
    if (initialHistory === undefined) return
    setHistory(current => current.length === 0 ? initialHistory : current)
  }, [initialHistory])

  useEffect(() => {
    setSelected(0)
  }, [query])

  useEffect(() => {
    setSelected(current => Math.min(current, Math.max(0, matches.length - 1)))
  }, [matches.length])

  useEffect(() => {
    onSuggestionsChange?.(showing ? matches.length + 1 : 0)
  }, [showing, matches.length, onSuggestionsChange])

  const change = (next: string, nextCursor: number): void => {
    setValue(next)
    setCursor(Math.max(0, Math.min(nextCursor, next.length)))
    setDismissed(false)
  }

  const insert = (text: string): void => {
    change(value.slice(0, cursor) + text + value.slice(cursor), cursor + text.length)
  }

  const erase = (): void => {
    if (cursor === 0) return
    change(value.slice(0, cursor - 1) + value.slice(cursor), cursor - 1)
  }

  const previous = (): void => {
    if (showing) {
      setSelected(current => Math.max(0, current - 1))
      return
    }
    const moved = verticalCursor(value, cursor, -1)
    if (moved !== undefined) { setCursor(moved); return }
    if (history.length === 0) return
    if (historyIndex === null) setDraft(value)
    const index = historyIndex === null ? history.length - 1 : Math.max(0, historyIndex - 1)
    setHistoryIndex(index)
    const entry = history[index] ?? ''
    change(entry, entry.length)
    // A recalled command stays a history entry; Up/Down continues the walk.
    setDismissed(true)
  }

  const next = (): void => {
    if (showing) {
      setSelected(current => Math.min(matches.length - 1, current + 1))
      return
    }
    const moved = verticalCursor(value, cursor, 1)
    if (moved !== undefined) { setCursor(moved); return }
    if (historyIndex === null) return
    const index = historyIndex + 1
    if (index >= history.length) {
      setHistoryIndex(null)
      change(draft, draft.length)
      return
    }
    setHistoryIndex(index)
    const entry = history[index] ?? ''
    change(entry, entry.length)
    setDismissed(true)
  }

  const complete = (): void => {
    const command = matches[Math.min(selected, matches.length - 1)]
    if (command === undefined) return
    const text = `/${command.name}${command.hint === undefined ? '' : ' '}`
    change(text, text.length)
    setDismissed(true)
  }

  const submit = (text: string): void => {
    const trimmed = text.trim()
    if (trimmed === '') return
    setHistory(current => [...current, trimmed])
    onRemember?.(trimmed)
    setHistoryIndex(null)
    setDraft('')
    setValue('')
    setCursor(0)
    setDismissed(false)
    onSubmit(trimmed)
  }

  useInput((input, key) => {
    if (isMouseInput(input)) return
    if (disabled) return
    if (key.return) {
      if (key.shift || key.meta || input === '\n') { insert('\n'); return }
      if (showing && !matches.some(command => `/${command.name}` === value)) {
        complete()
        return
      }
      submit(value)
      return
    }
    if (key.tab) { complete(); return }
    if (key.upArrow) { previous(); return }
    if (key.downArrow) { next(); return }
    if (key.leftArrow) { setCursor(current => Math.max(0, current - 1)); return }
    if (key.rightArrow) { setCursor(current => Math.min(value.length, current + 1)); return }
    if (key.backspace || key.delete) { erase(); return }
    if (key.ctrl && input === 'a') { setCursor(0); return }
    if (key.ctrl && input === 'e') { setCursor(value.length); return }
    if (key.escape) {
      if (showing) setDismissed(true)
      else change('', 0)
      return
    }
    if (input !== '' && !key.ctrl && !key.meta) insert(input)
  })

  const before = value.slice(0, cursor)
  const current = value[cursor] ?? ' '
  const after = value.slice(cursor + 1)
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={disabled ? theme.muted : theme.accent}
      paddingX={1}
      flexShrink={0}
    >
      <Text wrap="wrap">
        <Text color={theme.accent}>{'> '}</Text>
        {disabled ? value : <>{before}<Text inverse>{current}</Text>{after}</>}
        {value === '' && !disabled ? <Text color={theme.muted}> Ask anything…</Text> : null}
      </Text>
      {showing ? (
        <Box flexDirection="column">
          <Text color={theme.muted}>Commands</Text>
          {matches.map((command, index) => (
            <Text key={command.name} wrap="truncate-end">
              <Text color={index === selected ? theme.accent : theme.muted}>{index === selected ? '› ' : '  '}</Text>
              <Text color={index === selected ? theme.accent : theme.assistant} bold={index === selected}>
                {`/${command.name}`}
              </Text>
              <Text color={theme.muted}>{`  ${command.description}`}</Text>
              {command.hint === undefined ? null : <Text color={theme.muted}>{`  ${command.hint}`}</Text>}
            </Text>
          ))}
        </Box>
      ) : null}
      <Text color={theme.muted} wrap="truncate-end">
        {showing
          ? '⏎ run · Tab complete · ↑↓ select · Esc dismiss'
          : '⏎ send · ⇧⏎ newline · ↑↓ history · ^C stop · ^D exit · / commands'}
      </Text>
    </Box>
  )
}
