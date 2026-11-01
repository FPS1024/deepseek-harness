import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parseHistory, readHistoryFile, rememberInput, writeHistoryFile } from '../src/history.ts'

const directories: string[] = []

afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true })
})

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-tui-history-spec-'))
  directories.push(directory)
  return directory
}

describe('rememberInput', () => {
  it('appends trimmed entries and drops consecutive repeats', () => {
    expect(rememberInput([], '  first  ', 10)).toEqual(['first'])
    expect(rememberInput(['first'], 'first', 10)).toEqual(['first'])
    expect(rememberInput(['first'], 'second', 10)).toEqual(['first', 'second'])
  })

  it('ignores blank input and honors the retention limit', () => {
    const history = ['a', 'b']
    expect(rememberInput(history, '   ', 10)).toBe(history)
    expect(rememberInput(history, 'c', 0)).toBe(history)
    expect(rememberInput(history, 'c', 2)).toEqual(['b', 'c'])
  })
})

describe('parseHistory', () => {
  it('accepts a JSON array of strings', () => {
    expect(parseHistory('["a","b"]')).toEqual(['a', 'b'])
  })

  it('rejects invalid JSON and non-string arrays', () => {
    expect(() => parseHistory('{')).toThrow('history file is not valid JSON')
    expect(() => parseHistory('{"a":1}')).toThrow('history file must be a JSON array of strings')
    expect(() => parseHistory('[1]')).toThrow('history file must be a JSON array of strings')
  })
})

describe('history files', () => {
  it('treats a missing file as empty and truncates to the newest entries', async () => {
    const directory = await temporaryDirectory()
    const file = join(directory, 'history.json')
    expect(await readHistoryFile(file, 10)).toEqual([])
    await writeHistoryFile(file, ['a', 'b', 'c'])
    expect(await readHistoryFile(file, 10)).toEqual(['a', 'b', 'c'])
    expect(await readHistoryFile(file, 2)).toEqual(['b', 'c'])
  })

  it('creates parent directories and replaces the file atomically', async () => {
    const directory = await temporaryDirectory()
    const file = join(directory, 'nested', 'history.json')
    await writeHistoryFile(file, ['first'])
    await writeHistoryFile(file, ['second'])
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(['second'])
  })

  it('reports a path that exists but cannot be read', async () => {
    const directory = await temporaryDirectory()
    await expect(readHistoryFile(directory, 10)).rejects.toThrow()
  })

  it('reports a file that does not validate', async () => {
    const directory = await temporaryDirectory()
    const file = join(directory, 'history.json')
    await writeFile(file, '"not an array"', 'utf8')
    await expect(readHistoryFile(file, 10)).rejects.toThrow('history file must be a JSON array of strings')
  })
})
