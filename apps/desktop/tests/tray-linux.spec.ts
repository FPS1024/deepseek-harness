import type { MenuItemConstructorOptions } from 'electron'
import { afterEach, expect, it, vi } from 'vitest'
import { resolveDesktopLocale } from '../src/locale.ts'
import { LinuxTray, type LinuxTrayServiceState } from '../src/tray-linux.ts'

const native = await vi.hoisted(async () => {
  const { EventEmitter } = await import('node:events')
  const trays: FakeTray[] = []
  class FakeTray extends EventEmitter {
    readonly setToolTip = vi.fn()
    readonly setContextMenu = vi.fn()
    readonly destroy = vi.fn()
    constructor(readonly image: unknown) { super(); trays.push(this) }
  }
  const menus: MenuItemConstructorOptions[][] = []
  return {
    trays, FakeTray, menus,
    createFromPath: vi.fn((path: string) => ({ path })),
    buildFromTemplate: vi.fn((template: MenuItemConstructorOptions[]) => { menus.push(template); return { template } }),
  }
})
vi.mock('electron', () => ({
  Tray: native.FakeTray,
  nativeImage: { createFromPath: native.createFromPath },
  Menu: { buildFromTemplate: native.buildFromTemplate },
}))

afterEach(() => { native.trays.length = 0; native.menus.length = 0; vi.clearAllMocks() })

function setup(
  initial: LinuxTrayServiceState = { phase: 'running', pid: 4242 },
  autostart = false,
  locale = 'en',
) {
  let service = initial
  let enabled = autostart
  let current = resolveDesktopLocale(locale)
  const actions = {
    open: vi.fn(),
    startService: vi.fn(),
    pauseService: vi.fn(),
    restartService: vi.fn(),
    setAutostart: vi.fn((value: boolean) => { enabled = value }),
    quit: vi.fn(),
  }
  const tray = new LinuxTray({
    iconPath: '/app/resources/tray-linux.png',
    locale: () => current,
    service: () => service,
    autostart: () => enabled,
    ...actions,
  })
  return {
    tray, actions, native: native.trays[0]!,
    setService: (next: LinuxTrayServiceState) => { service = next },
    setLocale: (next: string) => { current = resolveDesktopLocale(next) },
    autostartEnabled: () => enabled,
  }
}

function labels(menu: MenuItemConstructorOptions[]): (string | undefined)[] {
  return menu.map(item => item.type === 'separator' ? 'separator' : item.label)
}

it('shows the running service, its PID, autostart, restart, and quit in one menu', () => {
  const f = setup()
  expect(native.createFromPath).toHaveBeenCalledWith('/app/resources/tray-linux.png')
  expect(f.native.setToolTip).toHaveBeenCalledWith('DeepSeek Harness · Service: running (PID 4242)')
  expect(labels(native.menus[0]!)).toEqual([
    'Open main window', 'separator',
    'Service: running (PID 4242)', 'Pause service', 'separator',
    'Start at login', 'separator',
    'Restart service', 'separator',
    'Quit',
  ])
})

it('offers Start service while paused and routes the toggles to their actions', () => {
  const f = setup({ phase: 'paused' })
  expect(labels(native.menus[0]!)).toContain('Start service')
  f.setService({ phase: 'running', pid: 99 })
  f.tray.relabel()
  expect(labels(native.menus[1]!)).toContain('Pause service')

  const running = native.menus[1]!
  Reflect.apply((running[3] as { click: () => void }).click, undefined, [])
  expect(f.actions.pauseService).toHaveBeenCalledOnce()

  f.setService({ phase: 'paused' })
  f.tray.relabel()
  Reflect.apply((native.menus[2]![3] as { click: () => void }).click, undefined, [])
  expect(f.actions.startService).toHaveBeenCalledOnce()
})

it('toggles the login autostart checkbox and restarts or quits from the menu', () => {
  const f = setup({ phase: 'running', pid: 1 }, false)
  const menu = native.menus[0]!
  const autostart = menu[5]!
  expect(autostart.type).toBe('checkbox')
  expect(autostart.checked).toBe(false)
  Reflect.apply(autostart.click!, undefined, [{ checked: true }])
  expect(f.actions.setAutostart).toHaveBeenCalledWith(true)
  expect(f.autostartEnabled()).toBe(true)

  Reflect.apply((menu[7] as { click: () => void }).click, undefined, [])
  expect(f.actions.restartService).toHaveBeenCalledOnce()
  Reflect.apply((menu[9] as { click: () => void }).click, undefined, [])
  expect(f.actions.quit).toHaveBeenCalledOnce()
})

it('opens the window from the first entry and relabels in the current locale', () => {
  const f = setup()
  Reflect.apply((native.menus[0]![0] as { click: () => void }).click, undefined, [])
  expect(f.actions.open).toHaveBeenCalledOnce()
  f.setLocale('zh')
  f.tray.relabel()
  expect(labels(native.menus[1]!)).toEqual([
    '打开主窗口', 'separator',
    '服务：运行中（PID 4242）', '暂停服务', 'separator',
    '开机自启', 'separator',
    '重启服务', 'separator',
    '退出',
  ])
})

it('destroys the icon once and ignores relabel after disposal', () => {
  const f = setup()
  f.tray.dispose()
  f.tray.dispose()
  expect(f.native.destroy).toHaveBeenCalledOnce()
  f.tray.relabel()
  expect(native.menus).toHaveLength(1)
})
