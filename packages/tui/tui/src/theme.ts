/**
 * Terminal color and glyph vocabulary. Kept in one module so every card reads
 * the same palette and a future theme setting has a single owner.
 * @module @deepseek-ai/dsh-tui/theme
 */

/** Color names accepted by Ink's `Text.color`. */
export const theme = {
  accent: 'cyan',
  brand: 'blueBright',
  user: 'green',
  assistant: 'white',
  muted: 'gray',
  error: 'red',
  warning: 'yellow',
  tool: 'magenta',
  diffAdded: 'green',
  diffRemoved: 'red',
  permission: 'yellow',
} as const

/** One-cell status and decoration glyphs. */
export const symbols = {
  user: '›',
  assistant: '◇',
  success: '✓',
  error: '✗',
  pending: '○',
  running: '●',
  cancelled: '■',
  permission: '?',
  thinking: '…',
  bullet: '•',
  quote: '│',
  rule: '─',
} as const
