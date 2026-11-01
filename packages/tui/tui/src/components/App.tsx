/**
 * Root terminal application: subscribes to the runtime snapshot, routes global
 * keys, and lays out the fixed-height regions.
 * @module @deepseek-ai/dsh-tui/components/App
 */

import * as React from 'react'
import { Box, useInput } from 'ink'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { isMouseInput } from '../mouse.ts'
import type { TuiConfig, TuiController, TuiPermissionView } from '../types.ts'
import { Composer } from './Composer.tsx'
import { Conversation } from './Conversation.tsx'
import { Header } from './Header.tsx'
import { ModelPicker, MODEL_WINDOW } from './ModelPicker.tsx'
import { useTerminalSize } from './hooks.ts'
import { PermissionPrompt, QuestionPrompt } from './Prompts.tsx'
import { SessionPicker } from './SessionPicker.tsx'
import { StatusBar } from './StatusBar.tsx'
import { useMouseWheel } from './useMouseWheel.ts'

/** Rows reserved while a questions panel is visible. */
const QUESTION_ROWS = 16
/** Rows reserved while the resume picker is visible. */
const PICKER_ROWS = 13

/**
 * Count the rows one approval panel occupies.
 * @param permission - pending approval and its optional call detail.
 * @returns border, header, action, and detail rows.
 */
function permissionRows(permission: TuiPermissionView): number {
  return 5
    + (permission.reason === undefined ? 0 : 1)
    + (permission.title === undefined ? 0 : 1)
    + (permission.description === undefined ? 0 : 1)
    + (permission.command === undefined ? 0 : 1)
    + (permission.cwd === undefined ? 0 : 1)
    + (permission.details?.length ?? 0)
}

/**
 * Render the terminal application.
 * @param props.runtime - snapshot owner and command entry point.
 * @param props.config - display bounds.
 * @param props.onExit - shutdown request owned by the terminal host.
 */
export function App({ runtime, config, onExit }: {
  readonly runtime: TuiController
  readonly config: TuiConfig
  readonly onExit: () => void
}) {
  const snapshot = useSyncExternalStore(listener => runtime.subscribe(listener), () => runtime.getSnapshot())
  const { columns, rows } = useTerminalSize()
  const [showThinking, setShowThinking] = useState(false)
  const [scrollBack, setScrollBack] = useState(0)
  const [suggestionRows, setSuggestionRows] = useState(0)

  const permission = snapshot.permission
  const question = snapshot.question
  const picker = snapshot.picker
  const modelPicker = snapshot.modelPicker

  useEffect(() => {
    setScrollBack(0)
    setSuggestionRows(0)
  }, [snapshot.sessionId])

  useEffect(() => {
    if (picker !== undefined || modelPicker !== undefined) setSuggestionRows(0)
  }, [picker, modelPicker])

  useMouseWheel((delta) => {
    setScrollBack(value => Math.max(0, Math.min(snapshot.transcript.length, value - delta)))
  })

  useInput((input, key) => {
    if (isMouseInput(input)) return
    if (key.ctrl && input === 'c') { runtime.interrupt(); return }
    if (key.ctrl && input === 'd') { onExit(); return }
    if (key.ctrl && input === 't') { setShowThinking(value => !value); return }
    if (picker !== undefined) {
      if (key.upArrow) { runtime.movePicker(-1); return }
      if (key.downArrow) { runtime.movePicker(1); return }
      if (key.return) { runtime.confirmPicker(); return }
      if (key.escape) { runtime.closePicker(); return }
      if (key.backspace || key.delete) { runtime.setPickerQuery(picker.query.slice(0, -1)); return }
      if (input !== '' && !key.ctrl && !key.meta && !key.tab) {
        runtime.setPickerQuery(picker.query + input)
      }
      return
    }
    if (modelPicker !== undefined) {
      if (key.upArrow || input === 'k') { runtime.moveModelPicker(-1); return }
      if (key.downArrow || input === 'j') { runtime.moveModelPicker(1); return }
      if (key.return) { void runtime.confirmModelPicker(); return }
      if (key.escape) { runtime.closeModelPicker() }
      return
    }
    if (permission !== undefined) {
      if (input === 'y' || input === 'Y' || key.return) runtime.resolvePermission('allowed-once')
      else if (input === 'n' || input === 'N' || key.escape) runtime.resolvePermission('rejected')
      return
    }
    if (question !== undefined) {
      const active = question.questions[question.active]
      const custom = active === undefined ? '' : question.custom[active.id] ?? ''
      if (key.return) { runtime.submitQuestion(); return }
      if (key.leftArrow) { runtime.stepQuestion(-1); return }
      if (key.rightArrow) { runtime.stepQuestion(1); return }
      if (key.backspace || key.delete) {
        runtime.setQuestionCustom(custom.slice(0, -1))
        return
      }
      if (input !== '' && /^[1-9]$/.test(input)) {
        const option = active?.options?.[Number(input) - 1]
        if (option !== undefined) runtime.toggleQuestionOption(option.label)
        return
      }
      if (input !== '' && !key.ctrl && !key.meta) {
        runtime.setQuestionCustom(custom + input)
        return
      }
      return
    }
    if (key.pageUp) { setScrollBack(value => Math.min(snapshot.transcript.length, value + 3)); return }
    if (key.pageDown) { setScrollBack(value => Math.max(0, value - 3)) }
  })

  const modelPickerRows = modelPicker === undefined
    ? 0
    : modelPicker.step === 'model' ? MODEL_WINDOW + 4 : modelPicker.efforts.length + 4
  const panelRows = permission !== undefined
    ? permissionRows(permission)
    : question !== undefined
      ? QUESTION_ROWS
      : picker !== undefined ? PICKER_ROWS : modelPickerRows
  const pickerOpen = picker !== undefined || modelPicker !== undefined
  const chromeRows = 2 + (pickerOpen ? 0 : 4) + 1
  const conversationRows = Math.max(3, rows - chromeRows - panelRows - suggestionRows)
  return (
    <Box flexDirection="column" height={rows} width={columns}>
      <Header
        model={snapshot.model}
        provider={snapshot.provider}
        reasoningEffort={snapshot.reasoningEffort}
        columns={columns}
      />
      <Conversation
        snapshot={snapshot}
        showThinking={showThinking}
        scrollBack={scrollBack}
        height={conversationRows}
        columns={columns}
        config={config}
      />
      {permission !== undefined ? <PermissionPrompt permission={permission} /> : null}
      {permission === undefined && question !== undefined
        ? <QuestionPrompt question={question} config={config} />
        : null}
      {permission === undefined && question === undefined && picker !== undefined
        ? <SessionPicker picker={picker} />
        : null}
      {permission === undefined && question === undefined && picker === undefined && modelPicker !== undefined
        ? (
          <ModelPicker
            picker={modelPicker}
            provider={snapshot.provider}
            model={snapshot.model}
            effort={snapshot.reasoningEffort}
          />
        )
        : null}
      {pickerOpen ? null : (
        <Composer
          key={snapshot.sessionId}
          disabled={permission !== undefined || question !== undefined}
          commands={runtime.commandCatalog()}
          initialHistory={runtime.history()}
          onRemember={(text) => { runtime.remember(text) }}
          onSuggestionsChange={setSuggestionRows}
          onSubmit={(text) => { void runtime.submit(text) }}
        />
      )}
      <StatusBar snapshot={snapshot} scrollBack={scrollBack} />
    </Box>
  )
}
