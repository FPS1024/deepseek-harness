import { describe, expect, it, vi } from 'vitest'
import {
  LINUX_RELEASE_REPOSITORY,
  fetchLinuxReleases,
  linuxInstallKind,
  releaseVersion,
  resolveReleaseRepository,
  selectLatestRelease,
  selectLinuxAsset,
  type LinuxRelease,
} from '../src/linux-update.ts'

function release(version: string, assets: readonly string[] = []): LinuxRelease {
  return {
    version,
    pageUrl: `https://github.com/example/repo/releases/tag/v${version}`,
    assets: assets.map(name => ({ name, url: `https://example.test/${name}` })),
  }
}

describe('linux release selection', () => {
  it('picks the highest semantic version, including prereleases', () => {
    const latest = selectLatestRelease([
      release('0.2.1-rc.2'),
      release('0.2.1-rc.4'),
      release('0.2.2-alpha.1'),
      release('0.2.0'),
    ], '0.2.1-rc.2')
    expect(latest?.release.version).toBe('0.2.2-alpha.1')
    expect(latest?.relation).toBe('newer')
  })

  it('reports the installed version as current, future, or older', () => {
    expect(selectLatestRelease([release('0.2.1-rc.4')], '0.2.1-rc.4')?.relation).toBe('same')
    expect(selectLatestRelease([release('0.2.1-rc.4')], '0.2.1')?.relation).toBe('older')
    expect(selectLatestRelease([release('0.2.1-rc.4')], '0.2.1-rc.3')?.relation).toBe('newer')
    expect(selectLatestRelease([], '0.2.1-rc.4')).toBeUndefined()
  })

  it('reads release tags as versions only when they parse', () => {
    expect(releaseVersion('v0.2.1-rc.4')).toBe('0.2.1-rc.4')
    expect(releaseVersion('0.2.1')).toBe('0.2.1')
    expect(releaseVersion('nightly')).toBeUndefined()
    expect(releaseVersion('v')).toBeUndefined()
  })

  it('selects the installer that matches the running install', () => {
    const published = release('0.2.1-rc.4', [
      'deepseek-harness-linux-v0.2.1-rc.4.x86_64.AppImage',
      'deepseek-harness-linux-v0.2.1-rc.4.x86_64.deb',
    ])
    expect(selectLinuxAsset(published, 'deb')?.name).toBe('deepseek-harness-linux-v0.2.1-rc.4.x86_64.deb')
    expect(selectLinuxAsset(published, 'appimage')?.name).toBe('deepseek-harness-linux-v0.2.1-rc.4.x86_64.AppImage')
    expect(selectLinuxAsset(release('0.2.1-rc.4', ['notes.txt']), 'deb')).toBeUndefined()
  })

  it('detects the install kind from the AppImage environment', () => {
    expect(linuxInstallKind({ APPIMAGE: '/home/user/Applications/deepseek-harness.AppImage' })).toBe('appimage')
    expect(linuxInstallKind({})).toBe('deb')
    expect(linuxInstallKind({ APPIMAGE: '' })).toBe('deb')
  })

  it('resolves the release repository and rejects malformed overrides', () => {
    expect(resolveReleaseRepository({})).toBe(LINUX_RELEASE_REPOSITORY)
    expect(resolveReleaseRepository({ DSH_DESKTOP_RELEASE_REPOSITORY: 'owner/repo' })).toBe('owner/repo')
    expect(() => resolveReleaseRepository({ DSH_DESKTOP_RELEASE_REPOSITORY: 'not a repository' }))
      .toThrow(/owner\/repository/u)
  })
})

describe('linux release listing', () => {
  it('drops drafts, unversioned tags, and malformed assets', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json([
      { tag_name: 'v0.2.1-rc.4', html_url: 'https://example.test/rc4', draft: false,
        assets: [{ name: 'app.deb', browser_download_url: 'https://example.test/app.deb' }, { name: 42 }] },
      { tag_name: 'v0.2.1-rc.3', html_url: 'https://example.test/rc3', draft: true, assets: [] },
      { tag_name: 'nightly', html_url: 'https://example.test/nightly', assets: [] },
      { tag_name: 'v0.2.1-rc.2', html_url: 'https://example.test/rc2', assets: [] },
    ]))
    const releases = await fetchLinuxReleases('owner/repo', fetchImpl)
    expect(releases.map(entry => entry.version)).toEqual(['0.2.1-rc.4', '0.2.1-rc.2'])
    expect(releases[0]?.assets).toEqual([{ name: 'app.deb', url: 'https://example.test/app.deb' }])
  })

  it('rejects a failed list request and a non-array payload', async () => {
    const failed = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 403 }))
    await expect(fetchLinuxReleases('owner/repo', failed)).rejects.toThrow(/HTTP 403/u)
    const malformed = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ message: 'rate limited' }))
    await expect(fetchLinuxReleases('owner/repo', malformed)).rejects.toThrow(/not an array/u)
  })
})
