import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { ModelSelection } from '@deepseek-ai/dsh-agent'
import { formatTokens, parseSlashCommand, runLocalCommand, type CommandHost } from '../src/commands.ts'
import { initialSnapshot } from '../src/state/state.ts'

function host(overrides: Partial<CommandHost> = {}): CommandHost {
  const infos: string[] = []
  const errors: string[] = []
  return {
    ctx: new Context(),
    agent: undefined,
    selection: { current: { provider: 'mock', model: 'mock' }, assembled: undefined },
    snapshot: initialSnapshot({ sessionId: 'session-1', cwd: '/tmp', provider: 'mock', model: 'mock' }),
    info: (text) => { infos.push(text) },
    error: (text) => { errors.push(text) },
    setRoute: (_selection: ModelSelection) => {},
    requestExit: () => {},
    openSessionPicker: async () => {},
    openModelPicker: async () => {},
    newSession: async () => {},
    resumeSession: async () => {},
    clearTranscript: () => {},
    ...overrides,
  }
}

describe('parseSlashCommand', () => {
  it('splits the name from verbatim input', () => {
    expect(parseSlashCommand('/help')).toEqual({ name: 'help', rawInput: '' })
    expect(parseSlashCommand('/model deepseek-chat')).toEqual({ name: 'model', rawInput: ' deepseek-chat' })
    expect(parseSlashCommand('/resume session-1')).toEqual({ name: 'resume', rawInput: ' session-1' })
  })

  it('rejects non-command syntax', () => {
    expect(parseSlashCommand('hello')).toBeUndefined()
    expect(parseSlashCommand('/Help')).toBeUndefined()
    expect(parseSlashCommand('/help!')).toBeUndefined()
    expect(parseSlashCommand('/1help')).toBeUndefined()
  })
})

describe('formatTokens', () => {
  it('scales unit suffixes', () => {
    expect(formatTokens(999)).toBe('999')
    expect(formatTokens(1_234)).toBe('1.2k')
    expect(formatTokens(1_234_567)).toBe('1.2M')
  })
})

describe('runLocalCommand', () => {
  it('describes the command surface', async () => {
    const infos: string[] = []
    expect(await runLocalCommand({ name: 'help', rawInput: '' }, host({ info: (text) => { infos.push(text) } }))).toBe(true)
    expect(infos.join('\n')).toContain('/resume [session-id]')
    expect(infos.join('\n')).toContain('/exit')
  })

  it('prints the current session', async () => {
    const infos: string[] = []
    await runLocalCommand({ name: 'session', rawInput: '' }, host({ info: (text) => { infos.push(text) } }))
    expect(infos.join('\n')).toContain('Session: session-1')
  })

  it('clears the transcript after acknowledging history is intact', async () => {
    const clearTranscript = vi.fn()
    const infos: string[] = []
    await runLocalCommand(
      { name: 'clear', rawInput: '' },
      host({ clearTranscript, info: (text) => { infos.push(text) } }),
    )
    expect(clearTranscript).toHaveBeenCalledOnce()
    expect(infos.join('\n')).toContain('Session history is unchanged')
  })

  it('requests exit', async () => {
    const requestExit = vi.fn()
    expect(await runLocalCommand({ name: 'exit', rawInput: '' }, host({ requestExit }))).toBe(true)
    expect(requestExit).toHaveBeenCalledOnce()
  })

  it('resumes the named session or opens the picker for an empty id', async () => {
    const resumeSession = vi.fn(async (_id: string) => {})
    const openSessionPicker = vi.fn(async () => {})
    await runLocalCommand({ name: 'resume', rawInput: ' session-9' }, host({ resumeSession }))
    expect(resumeSession).toHaveBeenCalledWith('session-9')
    await runLocalCommand({ name: 'resume', rawInput: '' }, host({ openSessionPicker }))
    expect(openSessionPicker).toHaveBeenCalledOnce()
  })

  it('starts a new session', async () => {
    const newSession = vi.fn(async () => {})
    await runLocalCommand({ name: 'new', rawInput: '' }, host({ newSession }))
    expect(newSession).toHaveBeenCalledOnce()
  })

  it('reports absent services instead of throwing', async () => {
    const errors: string[] = []
    const infos: string[] = []
    const local = host({ error: (text) => { errors.push(text) }, info: (text) => { infos.push(text) } })
    await runLocalCommand({ name: 'sessions', rawInput: '' }, local)
    await runLocalCommand({ name: 'model', rawInput: ' missing' }, local)
    await runLocalCommand({ name: 'tools', rawInput: '' }, local)
    await runLocalCommand({ name: 'context', rawInput: '' }, local)
    expect(errors.join('\n')).toContain('Session history is not available')
    expect(errors.join('\n')).toContain('model registry is not composed')
    expect(infos.join('\n')).toContain('Send a prompt first')
    expect(infos.join('\n')).toContain('Tokens: input 0')
  })

  it('opens the model picker when /model carries no argument', async () => {
    const openModelPicker = vi.fn(async () => {})
    await runLocalCommand({ name: 'model', rawInput: '' }, host({ openModelPicker }))
    expect(openModelPicker).toHaveBeenCalledOnce()
  })

  it('leaves unknown names for the shared command registry', async () => {
    expect(await runLocalCommand({ name: 'compact', rawInput: '' }, host())).toBe(false)
  })
})
