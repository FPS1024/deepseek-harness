/** Linux status tray: the always-present way back to a hidden window, service controls, and quit. */

import { Menu, nativeImage, Tray } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'
import { formatDesktopMessage, type DesktopLocale } from './locale.ts'

/** Service availability shown by the tray status entry. */
export type LinuxTrayServiceState =
  | { readonly phase: 'starting' }
  | { readonly phase: 'running'; readonly pid?: number | undefined }
  | { readonly phase: 'paused' }
  | { readonly phase: 'stopped' }

/** Main-process actions and state readers the tray consumes. */
export interface LinuxTrayOptions {
  /** PNG rendered from `resources/tray-linux.svg`; StatusNotifier hosts scale it to the panel. */
  readonly iconPath: string
  readonly locale: () => DesktopLocale
  /** Current service availability, including the Host process identifier while it runs. */
  readonly service: () => LinuxTrayServiceState
  /** Whether the login autostart entry currently exists. */
  readonly autostart: () => boolean
  /** Show and focus the primary window. */
  readonly open: () => void
  readonly startService: () => void
  readonly pauseService: () => void
  /** Restart the service, reopening the visible window on the new Host. */
  readonly restartService: () => void
  readonly setAutostart: (enabled: boolean) => void
  /** Request quit through the same confirmation as every other quit entry. */
  readonly quit: () => void
}

function statusLabel(messages: DesktopLocale['messages'], service: LinuxTrayServiceState): string {
  switch (service.phase) {
    case 'running':
      return formatDesktopMessage(messages.trayServiceRunning, { pid: service.pid === undefined ? '—' : String(service.pid) })
    case 'starting': return messages.trayServiceStarting
    case 'paused': return messages.trayServicePaused
    case 'stopped': return messages.trayServiceStopped
  }
}

function serviceToggle(
  options: LinuxTrayOptions,
  messages: DesktopLocale['messages'],
  service: LinuxTrayServiceState,
): MenuItemConstructorOptions {
  if (service.phase === 'running') {
    return { label: messages.trayPauseService, click: () => { options.pauseService() } }
  }
  if (service.phase === 'starting') {
    return { label: messages.trayPauseService, enabled: false }
  }
  return { label: messages.trayStartService, click: () => { options.startService() } }
}

/** Tray icon present for the whole run, not only while the window is hidden. */
export class LinuxTray {
  private tray: Tray | undefined

  /** @param options - Icon path, locale and state readers, and the service and window actions. */
  constructor(private readonly options: LinuxTrayOptions) {
    this.tray = new Tray(nativeImage.createFromPath(options.iconPath))
    this.relabel()
  }

  /** Rebuild the tooltip and context menu from the current locale and service state. */
  relabel(): void {
    const tray = this.tray
    if (tray === undefined) return
    const { messages } = this.options.locale()
    const service = this.options.service()
    const status = statusLabel(messages, service)
    tray.setToolTip(`${messages.aboutProduct} · ${status}`)
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: messages.trayOpenWindow, click: () => { this.options.open() } },
      { type: 'separator' },
      { label: status, enabled: false },
      serviceToggle(this.options, messages, service),
      { type: 'separator' },
      { label: messages.trayAutostart, type: 'checkbox', checked: this.options.autostart(),
        click: (item) => { this.options.setAutostart(item.checked) } },
      { type: 'separator' },
      { label: messages.trayRestartService, click: () => { this.options.restartService() } },
      { type: 'separator' },
      { label: messages.quit, click: () => { this.options.quit() } },
    ]))
  }

  /** Remove the icon; called once the quit is confirmed so no dead icon outlives the process. */
  dispose(): void {
    const tray = this.tray
    this.tray = undefined
    tray?.destroy()
  }
}
