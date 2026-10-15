/**
 * Update manifest handling (v3.0), pure and shared.
 *
 * The app had no auto-update at all: `electron-builder.yml` had `publish: null` and nothing
 * read a release feed, so a user could sit on an old build forever. Reported by the user as
 * "no auto-update".
 *
 * This module is deliberately dependency-free and free of I/O, so the version comparison and
 * manifest parsing — the parts that can silently be wrong and ship a *downgrade* or miss an
 * update — are unit-testable without a network, a file system or Electron. The fetch/download
 * side lives behind injected boundaries in `main/updater.ts`.
 *
 * The feed is the GitHub Releases API for this repository: it needs no extra file to publish
 * and no token when the repository is public.
 */
export interface UpdateAsset {
  name: string
  url: string
  size?: number
}

export interface UpdateManifest {
  /** Version without a leading `v`, e.g. `3.0.1`. */
  version: string
  /** Installer download URL. */
  url: string
  size?: number
  /** Release notes body, truncated by the caller if needed. */
  notes?: string
  releasedAt?: string
  /** Every asset of the release, so the caller can find `SHA256SUMS.txt` too. */
  assets: UpdateAsset[]
}

export interface UpdateCheckResult {
  current: string
  latest: string | null
  available: boolean
  manifest?: UpdateManifest
  /** Why the check could not produce an answer, when it could not. */
  reason?: 'not-configured' | 'unreachable' | 'no-release' | 'unparsable'
  message?: string
}

/** Outcome of downloading (and verifying) the installer. */
export interface UpdateDownloadResult {
  ok: boolean
  path?: string
  bytes?: number
  error?: string
  /** True when a published digest existed and matched. */
  verified?: boolean
}

/** Compare two dotted numeric versions. Returns -1, 0 or 1 (unparsable counts as 0.0.0). */
export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a)
  const right = parseVersion(b)
  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    const l = left[index] ?? 0
    const r = right[index] ?? 0
    if (l !== r) return l < r ? -1 : 1
  }
  return 0
}

/** `v3.0.1-beta.2` -> `[3, 0, 1]`. A pre-release suffix is ignored: it is not newer. */
export function parseVersion(version: string): number[] {
  if (typeof version !== 'string') return [0, 0, 0]
  const cleaned = version.trim().replace(/^v/i, '')
  const core = cleaned.split(/[-+]/)[0] ?? ''
  const parts = core.split('.').map((part) => {
    const value = Number.parseInt(part, 10)
    return Number.isFinite(value) && value >= 0 ? value : 0
  })
  // Always at least three components, so `compareVersions('3.0', '3.0.0')` and the shape of
  // an unparsable string are both predictable.
  while (parts.length < 3) parts.push(0)
  return parts
}

/** True when `candidate` is strictly newer than `current`. */
export function isNewerVersion(candidate: string, current: string): boolean {
  return compareVersions(candidate, current) > 0
}

/** Only the installer matters for an update; a portable exe cannot update itself. */
export function pickInstaller(assets: readonly UpdateAsset[]): UpdateAsset | undefined {
  return assets.find((asset) => /setup.*\.exe$/i.test(asset.name))
}

/** The checksum file published beside every release, when present. */
export function pickChecksumFile(assets: readonly UpdateAsset[]): UpdateAsset | undefined {
  return assets.find((asset) => /^sha256sums(\.txt)?$/i.test(asset.name))
}

/**
 * Parse a GitHub `releases/latest` payload into a manifest.
 *
 * Deliberately tolerant about the shape (it is external data) but strict about the two things
 * that must be right: a version and a URL. A missing installer asset yields `undefined` rather
 * than a manifest pointing at a source archive.
 */
export function parseRelease(raw: unknown): UpdateManifest | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const record = raw as Record<string, unknown>
  const tag = typeof record.tag_name === 'string' ? record.tag_name : ''
  const version = tag.replace(/^v/i, '').trim()
  if (!version) return undefined

  const rawAssets = Array.isArray(record.assets) ? record.assets : []
  const assets: UpdateAsset[] = []
  for (const entry of rawAssets) {
    if (typeof entry !== 'object' || entry === null) continue
    const asset = entry as Record<string, unknown>
    const name = typeof asset.name === 'string' ? asset.name : ''
    const url = typeof asset.browser_download_url === 'string' ? asset.browser_download_url : ''
    if (!name || !url) continue
    assets.push({
      name,
      url,
      ...(typeof asset.size === 'number' ? { size: asset.size } : {})
    })
  }

  const installer = pickInstaller(assets)
  if (!installer) return undefined

  return {
    version,
    url: installer.url,
    ...(installer.size !== undefined ? { size: installer.size } : {}),
    ...(typeof record.body === 'string' && record.body.trim() ? { notes: record.body } : {}),
    ...(typeof record.published_at === 'string' ? { releasedAt: record.published_at } : {}),
    assets
  }
}

/** Extract `sha256  name` pairs from a `SHA256SUMS.txt` body. */
export function parseChecksums(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const match = /^\s*([0-9a-f]{64})\s+\*?(.+?)\s*$/i.exec(line)
    if (!match) continue
    out[match[2]!.trim()] = match[1]!.toLowerCase()
  }
  return out
}

/** The expected digest for `fileName`, tolerating a GitHub-renamed file (`AI.Desktop.Setup.x.exe`). */
export function expectedDigest(
  checksums: Record<string, string>,
  fileName: string
): string | undefined {
  const direct = checksums[fileName]
  if (direct) return direct
  const normalised = fileName.replace(/[^a-z0-9]/gi, '').toLowerCase()
  for (const [name, digest] of Object.entries(checksums)) {
    if (name.replace(/[^a-z0-9]/gi, '').toLowerCase() === normalised) return digest
  }
  return undefined
}

/** "112 MB" / "1.4 MB" — enough for a download button label. */
export function formatUpdateSize(bytes?: number): string {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes <= 0) return ''
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}

/** A short, human summary of the check outcome — the same words the UI shows. */
export function describeCheck(result: UpdateCheckResult): string {
  if (result.available && result.latest) return `Update ${result.latest} is available`
  if (result.reason === 'not-configured') return 'Update feed is not configured'
  if (result.reason === 'unreachable') {
    return result.message ?? 'Update feed is unreachable'
  }
  if (result.reason === 'no-release' || result.reason === 'unparsable') {
    return 'No usable release found on the update feed'
  }
  return 'You are up to date'
}
