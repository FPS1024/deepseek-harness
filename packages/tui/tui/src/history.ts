/**
 * Durable composer history: the bounded entry list, its JSON file format, and
 * the atomic file operations the terminal runtime performs around it.
 * @module @deepseek-ai/dsh-tui/history
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/**
 * Append one submitted line to the shell-style history.
 * @param history - entries in submission order.
 * @param text - submitted composer text.
 * @param limit - maximum retained entries; zero keeps none.
 * @returns the next entry list, or the input list when nothing changed.
 */
export function rememberInput(
  history: readonly string[], text: string, limit: number,
): readonly string[] {
  const entry = text.trim()
  if (entry === '' || limit === 0) return history
  if (history.at(-1) === entry) return history
  const next = [...history, entry]
  return next.length > limit ? next.slice(next.length - limit) : next
}

/**
 * Validate the stored JSON representation of the history.
 * @param text - complete history file contents.
 * @returns the validated entries in stored order.
 * @throws when the text is not JSON or not an array of strings.
 */
export function parseHistory(text: string): readonly string[] {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (error) {
    throw new Error('history file is not valid JSON', { cause: error })
  }
  if (!Array.isArray(value) || !value.every(entry => typeof entry === 'string')) {
    throw new Error('history file must be a JSON array of strings')
  }
  return value
}

/**
 * Read the bounded history, treating an absent file as an empty history.
 * @param path - absolute history file path.
 * @param limit - maximum entries returned; the newest entries win.
 * @returns stored entries, or an empty list when the file does not exist.
 * @throws when the file exists but cannot be read or does not validate.
 */
export async function readHistoryFile(path: string, limit: number): Promise<readonly string[]> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const entries = parseHistory(text)
  return entries.length > limit ? entries.slice(entries.length - limit) : entries
}

/**
 * Replace the history file through a same-directory rename.
 * @param path - absolute history file path; parent directories are created.
 * @param entries - entries to store, oldest first.
 * @returns fulfillment once the replacement is visible.
 */
export async function writeHistoryFile(path: string, entries: readonly string[]): Promise<void> {
  const temporary = `${path}.${String(process.pid)}.tmp`
  await mkdir(dirname(path), { recursive: true })
  await writeFile(temporary, `${JSON.stringify(entries)}\n`, 'utf8')
  await rename(temporary, path)
}
