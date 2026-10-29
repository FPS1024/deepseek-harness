/** Login autostart for the Linux Desktop service: one per-user XDG desktop entry. */

import { existsSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'

/** File name shared by the autostart entry and the installed desktop entry. */
const AUTOSTART_FILE = 'deepseek-harness.desktop'

/**
 * Resolve the per-user autostart entry path.
 * @param environment - Desktop process environment.
 * @returns Absolute path under `XDG_CONFIG_HOME` or the default `~/.config`.
 */
export function autostartEntryPath(environment: NodeJS.ProcessEnv = process.env): string {
  const configured = environment.XDG_CONFIG_HOME?.trim()
  const configHome = configured === undefined || configured === '' ? join(homedir(), '.config') : configured
  return join(configHome, 'autostart', AUTOSTART_FILE)
}

/**
 * Whether login autostart is currently enabled.
 * @param environment - Desktop process environment.
 * @returns Whether the entry file exists.
 */
export function autostartEnabled(environment: NodeJS.ProcessEnv = process.env): boolean {
  return existsSync(autostartEntryPath(environment))
}

/**
 * Quote one Exec argument for a desktop entry.
 * @param value - Absolute executable path.
 * @returns The path quoted per the Desktop Entry specification.
 */
export function quoteDesktopExec(value: string): string {
  return `"${value.replace(/\\/gu, '\\\\').replace(/"/gu, '\\"')}"`
}

/**
 * Render the autostart entry that starts the service without opening a window.
 * @param executable - Absolute path of the running application or AppImage.
 * @returns Complete desktop-entry content.
 */
export function autostartEntry(executable: string): string {
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Name=DeepSeek Harness',
    'Comment=Start the DeepSeek Harness service at login',
    `Exec=${quoteDesktopExec(executable)} --hidden`,
    'Terminal=false',
    'X-GNOME-Autostart-enabled=true',
    '',
  ].join('\n')
}

/**
 * Enable or disable login autostart.
 * @param enabled - Whether the entry should exist.
 * @param executable - Absolute path launched at login.
 * @param environment - Desktop process environment.
 * @returns Completion after the entry file is written or removed.
 */
export async function setAutostart(
  enabled: boolean,
  executable: string,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const path = autostartEntryPath(environment)
  if (!enabled) {
    rmSync(path, { force: true })
    return
  }
  await writeFileAtomic(path, autostartEntry(executable), { mode: 0o644 })
}
