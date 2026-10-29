/** Manual Linux updates: compare the installed version with the newest published GitHub release. */

import { eq, gt, valid } from 'semver'

/** Repository that publishes the Linux Desktop packages. */
export const LINUX_RELEASE_REPOSITORY = 'FPS1024/deepseek-harness'

/** Environment variable that overrides {@link LINUX_RELEASE_REPOSITORY} for qualification runs. */
export const LINUX_RELEASE_REPOSITORY_ENV = 'DSH_DESKTOP_RELEASE_REPOSITORY'

/** One downloadable file attached to a release. */
export interface LinuxReleaseAsset {
  /** File name used to recognize the installer kind. */
  readonly name: string
  /** Browser download URL opened by the update prompt. */
  readonly url: string
}

/** One published release that carries a parseable semantic version. */
export interface LinuxRelease {
  /** Semantic version without the leading `v`. */
  readonly version: string
  /** Release page shown when no installer asset matches the running install. */
  readonly pageUrl: string
  /** Attached files in release order. */
  readonly assets: readonly LinuxReleaseAsset[]
}

/** How the running copy was installed, which selects the installer asset. */
export type LinuxInstallKind = 'deb' | 'appimage'

/** Relative position of the installed version against the newest release. */
export type LinuxUpdateRelation = 'newer' | 'same' | 'older'

/** Outcome of comparing the installed version with the newest release. */
export interface LinuxUpdateAvailability {
  /** `newer` means the release is newer than the installed version. */
  readonly relation: LinuxUpdateRelation
  readonly release: LinuxRelease
}

/**
 * Resolve the repository whose releases carry Linux installers.
 * @param environment - Desktop process environment.
 * @returns `owner/repository`, validated when overridden.
 */
export function resolveReleaseRepository(environment: NodeJS.ProcessEnv = process.env): string {
  const value = environment[LINUX_RELEASE_REPOSITORY_ENV]?.trim()
  if (value === undefined || value === '') return LINUX_RELEASE_REPOSITORY
  if (!/^[\w.-]+\/[\w.-]+$/u.test(value)) {
    throw new Error(`${LINUX_RELEASE_REPOSITORY_ENV} must be owner/repository; got ${JSON.stringify(value)}`)
  }
  return value
}

/**
 * Detect the installer kind from the process that is running.
 * The AppImage runtime exports `APPIMAGE`; every other packaged Linux install is the Debian package.
 * @param environment - Desktop process environment.
 * @returns Installer kind whose asset the update prompt should open.
 */
export function linuxInstallKind(environment: NodeJS.ProcessEnv = process.env): LinuxInstallKind {
  return environment.APPIMAGE === undefined || environment.APPIMAGE === '' ? 'deb' : 'appimage'
}

/**
 * Read a release tag as a semantic version.
 * @param tag - Git tag such as `v0.2.1-rc.4`.
 * @returns Version without the prefix, or `undefined` when the tag is not a version.
 */
export function releaseVersion(tag: string): string | undefined {
  const version = tag.startsWith('v') ? tag.slice(1) : tag
  return valid(version) ?? undefined
}

/**
 * Compare the installed version with every published release.
 * Drafts and releases without a version tag are ignored; prereleases participate.
 * @param releases - Releases read from the repository API.
 * @param currentVersion - Version of the running application.
 * @returns The newest release and its relation to the installed version, or `undefined` when none is usable.
 */
export function selectLatestRelease(
  releases: readonly LinuxRelease[],
  currentVersion: string,
): LinuxUpdateAvailability | undefined {
  const newest = releases.reduce<LinuxRelease | undefined>((best, release) =>
    best === undefined || gt(release.version, best.version) ? release : best, undefined)
  if (newest === undefined) return undefined
  const relation: LinuxUpdateRelation = eq(newest.version, currentVersion)
    ? 'same'
    : gt(newest.version, currentVersion) ? 'newer' : 'older'
  return { relation, release: newest }
}

/**
 * Pick the installer asset for the running install kind.
 * @param release - Release whose assets are searched.
 * @param kind - Installer kind that the user can open.
 * @returns Matching asset, or `undefined` when the release does not ship that installer.
 */
export function selectLinuxAsset(release: LinuxRelease, kind: LinuxInstallKind): LinuxReleaseAsset | undefined {
  const suffix = kind === 'deb' ? '.deb' : '.AppImage'
  return release.assets.find(asset => asset.name.endsWith(suffix))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseAsset(value: unknown): LinuxReleaseAsset | undefined {
  if (!isRecord(value) || typeof value.name !== 'string' || typeof value.browser_download_url !== 'string') return undefined
  return { name: value.name, url: value.browser_download_url }
}

function parseRelease(value: unknown): LinuxRelease | undefined {
  if (!isRecord(value) || value.draft === true) return undefined
  if (typeof value.tag_name !== 'string' || typeof value.html_url !== 'string') return undefined
  const version = releaseVersion(value.tag_name)
  if (version === undefined) return undefined
  const assets = Array.isArray(value.assets)
    ? value.assets.map(parseAsset).filter((asset): asset is LinuxReleaseAsset => asset !== undefined)
    : []
  return { version, pageUrl: value.html_url, assets }
}

/**
 * Read published releases from the GitHub API.
 * @param repository - `owner/repository` whose releases are listed.
 * @param fetchImpl - Response-returning transport, always Electron's `net.fetch` in the shell.
 * @returns Usable releases; entries without a version tag or marked as drafts are dropped.
 */
export async function fetchLinuxReleases(
  repository: string,
  fetchImpl: typeof fetch,
): Promise<readonly LinuxRelease[]> {
  const response = await fetchImpl(`https://api.github.com/repos/${repository}/releases?per_page=100`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'deepseek-harness-desktop' },
  })
  if (!response.ok) throw new Error(`release list failed with HTTP ${String(response.status)}`)
  const payload: unknown = await response.json()
  if (!Array.isArray(payload)) throw new Error('release list is not an array')
  return payload.map(parseRelease).filter((release): release is LinuxRelease => release !== undefined)
}
