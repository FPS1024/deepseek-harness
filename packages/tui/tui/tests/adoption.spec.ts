import { describe, expect, it } from 'vitest'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import { SESSION_FORMAT_VERSION, Session, SessionId, type SessionHeader } from '@deepseek-ai/dsh-session'
import { adoptedRoute } from '../src/runtime.ts'

const CWD = '/work'

function header(overrides: Partial<SessionHeader> = {}): SessionHeader {
  return {
    version: SESSION_FORMAT_VERSION,
    id: SessionId('session-adopt'),
    createdAt: 1,
    cwd: CWD,
    isSeeded: false,
    ...overrides,
  }
}

function session(overrides: Partial<SessionHeader> = {}): Session {
  return Session.create(SessionId('session-adopt'), [], header(overrides))
}

describe('adoptedRoute', () => {
  it('accepts an ordinary session in the current directory', () => {
    expect(adoptedRoute(session(), CWD)).toBeUndefined()
  })

  it('rejects a subagent root', () => {
    expect(() => adoptedRoute(session({ origin: 'subagent' }), CWD)).toThrow('subagent or forked child')
  })

  it('rejects a forked child', () => {
    expect(() => adoptedRoute(session({ parentSession: SessionId('parent') }), CWD)).toThrow('subagent or forked child')
  })

  it('rejects a session whose header records a preset', () => {
    expect(() => adoptedRoute(session({ agentPreset: 'review' }), CWD)).toThrow('does not compose')
  })

  it('rejects a session whose log selected a preset later', () => {
    const stored = session()
    stored.append('agent-preset/selected', { agentPreset: 'review' })
    expect(() => adoptedRoute(stored, CWD)).toThrow('does not compose')
  })

  it('rejects a session without a recorded directory', () => {
    const stored = Session.create(SessionId('session-adopt'), [], {
      version: SESSION_FORMAT_VERSION,
      id: SessionId('session-adopt'),
      createdAt: 1,
      isSeeded: false,
    })
    expect(() => adoptedRoute(stored, CWD)).toThrow('recorded no working directory')
  })

  it('rejects a session from another directory', () => {
    expect(() => adoptedRoute(session({ cwd: '/elsewhere' }), CWD)).toThrow('was recorded in')
  })
})
