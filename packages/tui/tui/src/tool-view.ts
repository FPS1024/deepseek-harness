/**
 * Tool-call description helpers shared by the terminal components. They read
 * only the raw arguments and result text the Session records, so presentation
 * never depends on a live tool definition.
 * @module @deepseek-ai/dsh-tui/tool-view
 */

import type { JsonValue } from '@deepseek-ai/dsh-util-values'

/** Salient facts derived from one tool call's raw arguments. */
export interface ToolSummary {
  /** Shell command, when the arguments carry one. */
  readonly command?: string
  /** Path the call reads or modifies, when the arguments carry one. */
  readonly path?: string
  /** Compact remaining detail, or the whole argument object for unknown tools. */
  readonly detail: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Parse raw model-provided tool arguments.
 * @param raw - JSON string exactly as the model produced it.
 * @returns the parsed value, or undefined when the text is not JSON.
 */
export function parseArguments(raw: string): JsonValue | undefined {
  if (raw.trim() === '') return undefined
  try {
    return JSON.parse(raw) as JsonValue
  } catch {
    return undefined
  }
}

function firstString(record: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value !== '') return value
  }
  return undefined
}

function compact(value: string | Record<string, unknown>, limit = 240): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`
}

function firstLine(text: string): string {
  /* v8 ignore next -- split always returns at least one element */
  return text.split('\n')[0] ?? ''
}

/**
 * Describe one tool call for a terminal card.
 * @param name - model-facing tool name.
 * @param raw - raw JSON arguments.
 * @returns command/path when present plus a compact detail line.
 */
export function summarizeToolCall(name: string, raw: string): ToolSummary {
  const parsed = parseArguments(raw)
  if (!isRecord(parsed)) return { detail: raw === '' ? '' : compact(raw) }
  const command = firstString(parsed, ['command', 'cmd'])
  const path = firstString(parsed, ['path', 'file_path', 'filePath', 'target'])
  if (command !== undefined) return { command, detail: '' }
  if (path !== undefined) return { path, detail: '' }
  if (name === 'run_code') {
    const code = firstString(parsed, ['code', 'source'])
    if (code !== undefined) return { detail: compact(firstLine(code)) }
  }
  return { detail: compact(parsed) }
}

function textLines(text: string): string[] {
  const lines = text.replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  return lines
}

/**
 * Keep the first lines of a tool result and report how many were hidden.
 * @param text - complete result text.
 * @param limit - maximum retained lines; zero retains none.
 * @returns retained lines and the hidden-line count.
 */
export function resultPreview(text: string, limit: number): { lines: readonly string[]; hidden: number } {
  const lines = textLines(text)
  if (limit <= 0) return { lines: [], hidden: lines.length }
  if (lines.length <= limit) return { lines, hidden: 0 }
  return { lines: lines.slice(0, limit), hidden: lines.length - limit }
}

/**
 * Keep the newest lines of live tool output and report how many were hidden.
 * @param text - output received so far.
 * @param limit - maximum retained lines; zero retains none.
 * @returns the trailing lines and the hidden-line count.
 */
export function resultTail(text: string, limit: number): { lines: readonly string[]; hidden: number } {
  const lines = textLines(text)
  if (limit <= 0) return { lines: [], hidden: lines.length }
  if (lines.length <= limit) return { lines, hidden: 0 }
  return { lines: lines.slice(-limit), hidden: lines.length - limit }
}

/**
 * One-line error text for a failed tool result.
 * @param code - structured failure code, when recorded.
 * @param reason - human-facing reason, when recorded.
 * @returns the reason, the code, or a generic failure label.
 */
export function toolErrorText(code: string | undefined, reason: string | undefined): string {
  if (reason !== undefined && reason !== '') return reason
  if (code !== undefined && code !== '') return code
  return 'tool failed'
}
