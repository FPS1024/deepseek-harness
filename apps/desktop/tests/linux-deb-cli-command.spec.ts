import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const install = readFileSync(new URL('../scripts/linux-deb-post-install.sh', import.meta.url), 'utf8')
const remove = readFileSync(new URL('../scripts/linux-deb-post-remove.sh', import.meta.url), 'utf8')

describe('Linux deb CLI command', () => {
  it('links the bundled dsh launcher without replacing an existing command', () => {
    expect(install).toContain('cli_command=/usr/bin/dsh')
    expect(install).toContain('cli_target=/opt/deepseek-harness/resources/runtime/cli/bin/dsh')
    expect(install).toContain('ln -s "$cli_target" "$cli_command"')
    expect(install).toContain('not replacing existing $cli_command')
  })

  it('removes only its own link on uninstall', () => {
    expect(remove).toContain('cli_command=/usr/bin/dsh')
    expect(remove).toContain('cli_target=/opt/deepseek-harness/resources/runtime/cli/bin/dsh')
    expect(remove).toContain('rm -f "$cli_command"')
  })
})
