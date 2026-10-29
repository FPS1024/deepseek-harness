/** Rasterize the Linux tray icon from the web favicon source into the committed PNG. */

import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

/** Vector source and committed output of the Linux tray icon. */
export const LINUX_TRAY_ICON_PATHS = {
  source: fileURLToPath(new URL('../resources/tray-linux.svg', import.meta.url)),
  output: fileURLToPath(new URL('../resources/tray-linux.png', import.meta.url)),
} as const

/** Square edge: 64 px serves 1× and 2× status-notifier panels after downscaling. */
export const LINUX_TRAY_ICON_SIZE = 64

/** Coordinate space of the vector source; sharp's SVG density is scaled against it. */
const SOURCE_EDGE = 50
const SOURCE_DENSITY = 72

/**
 * Rasterize the vector tray source at one square edge.
 * @param source - SVG document.
 * @param size - Square edge in pixels.
 * @returns PNG bytes.
 */
export async function renderLinuxTrayIcon(source: Buffer, size: number = LINUX_TRAY_ICON_SIZE): Promise<Buffer> {
  return sharp(source, { density: SOURCE_DENSITY * size / SOURCE_EDGE })
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer()
}

async function main(): Promise<void> {
  const png = await renderLinuxTrayIcon(await readFile(LINUX_TRAY_ICON_PATHS.source))
  await writeFile(LINUX_TRAY_ICON_PATHS.output, png)
  console.info(`tray icon: wrote ${LINUX_TRAY_ICON_PATHS.output} at ${String(LINUX_TRAY_ICON_SIZE)} px`)
}

if (process.argv[1] !== undefined && import.meta.filename === resolve(process.argv[1])) await main()
