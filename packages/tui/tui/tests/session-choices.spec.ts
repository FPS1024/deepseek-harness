import { describe, expect, it } from 'vitest'
import { SESSION_FORMAT_VERSION, SessionId, type SessionHeader } from '@deepseek-ai/dsh-session'
import type { SessionRecord } from '@deepseek-ai/dsh-session-query'
import { sessionChoices } from '../src/runtime.ts'

const CWD = '/work'

function header(id: string, overrides: Partial<SessionHeader> = {}): SessionHeader {
  return {
    version: SESSION_FORMAT_VERSION,
    id: SessionId(id),
    createdAt: 1_700_000_000_000,
    cwd: CWD,
    isSeeded: false,
    ...overrides,
  }
}

function record(id: string, overrides: Partial<SessionHeader> = {}, live = false): SessionRecord {
  return { header: header(id, overrides), live, persisted: !live }
}

function recordWithoutDirectory(id: string): SessionRecord {
  return {
    header: { version: SESSION_FORMAT_VERSION, id: SessionId(id), createdAt: 1_700_000_000_000, isSeeded: false },
    live: false,
    persisted: true,
  }
}

describe('sessionChoices', () => {
  it('maps adoptable records in input order', () => {
    expect(sessionChoices([record('a', {}, true), record('b')], CWD, 'current')).toEqual([
      { id: 'a', createdAt: 1_700_000_000_000, cwd: CWD, live: true },
      { id: 'b', createdAt: 1_700_000_000_000, cwd: CWD, live: false },
    ])
  })

  it('excludes the current session, other directories, children, and presets', () => {
    const choices = sessionChoices([
      record('current'),
      record('elsewhere', { cwd: '/other' }),
      record('child', { parentSession: SessionId('parent') }),
      record('subagent', { origin: 'subagent' }),
      record('preset', { agentPreset: 'review' }),
      recordWithoutDirectory('no-directory'),
      record('ok'),
    ], CWD, 'current')
    expect(choices.map(choice => choice.id)).toEqual(['ok'])
  })

  it('caps the list at fifty rows', () => {
    const records = Array.from({ length: 60 }, (_, index) => record(`s-${String(index)}`))
    expect(sessionChoices(records, CWD, 'current')).toHaveLength(50)
  })
})
