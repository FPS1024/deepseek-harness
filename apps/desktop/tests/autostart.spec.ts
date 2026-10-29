import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { autostartEnabled, autostartEntryPath, quoteDesktopExec, setAutostart } from '../src/autostart.ts'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function environment(): NodeJS.ProcessEnv {
  const root = mkdtempSync(join(tmpdir(), 'dsh-autostart-'))
  roots.push(root)
  return { XDG_CONFIG_HOME: join(root, 'config') }
}

it('writes and removes the login entry under XDG_CONFIG_HOME', async () => {
  const env = environment()
  const path = autostartEntryPath(env)
  expect(path).toBe(join(env.XDG_CONFIG_HOME!, 'autostart', 'deepseek-harness.desktop'))
  expect(autostartEnabled(env)).toBe(false)
  await setAutostart(true, '/opt/deepseek-harness/deepseek-harness', env)
  expect(autostartEnabled(env)).toBe(true)
  const content = readFileSync(path, 'utf8')
  expect(content).toContain('Exec="/opt/deepseek-harness/deepseek-harness" --hidden')
  expect(content).toContain('X-GNOME-Autostart-enabled=true')
  await setAutostart(false, '/opt/deepseek-harness/deepseek-harness', env)
  expect(existsSync(path)).toBe(false)
})

it('quotes executable paths for the desktop entry', () => {
  expect(quoteDesktopExec('/opt/plain/app')).toBe('"/opt/plain/app"')
  expect(quoteDesktopExec('/home/user/My Apps/app"x')).toBe('"/home/user/My Apps/app\\"x"')
})
