/**
 * Auto-update (v3.0).
 *
 * The app had none — `publish: null`, no feed reader, no way to learn a newer build existed —
 * which the user reported as "no auto-update". This service checks the GitHub Releases API for
 * the newest release, downloads the NSIS installer, **verifies its SHA-256 against the release's
 * own `SHA256SUMS.txt`**, and only then hands it to the OS.
 *
 * Why not `electron-updater`: this app ships exactly one runtime dependency (`ssh2`) and the
 * packaged app carries no `node_modules`. A dependency-free updater keeps that property, keeps
 * the installer ~107 MB, and lets the verification step be *ours* — for an unsigned build,
 * checking the published digest before running an installer is the only integrity guarantee
 * there is.
 *
 * Every side effect is injected (`fetchImpl`, `writeFile`, `hashFile`, `runInstaller`), so the
 * whole flow is testable under plain Node with no network and no Electron.
 */
import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  expectedDigest,
  isNewerVersion,
  parseChecksums,
  parseRelease,
  pickChecksumFile,
  type UpdateCheckResult,
  type UpdateDownloadResult,
  type UpdateManifest
} from '@shared/update'

/**
 * Where the feed lives: a dedicated PUBLIC repository that holds only release binaries and
 * their checksums. The application source stays private (its git history still contains
 * infrastructure addresses that cannot be removed without invalidating every existing tag),
 * and public Releases need no token to read — a private repository answers 404 instead.
 */
export const DEFAULT_UPDATE_REPO = 'Arashtahmasbi3/ai-desktop-releases'

export interface UpdateProgress {
  received: number
  total?: number
}

export interface UpdateServiceDeps {
  /** Injected fetch boundary. */
  fetchImpl: (url: string) => Promise<{
    ok: boolean
    status: number
    text(): Promise<string>
  }>
  /** Current app version, injected so tests are not tied to package.json. */
  currentVersion: string
  /** Download a URL to a destination path, reporting progress. */
  download: (
    url: string,
    destination: string,
    onProgress: (progress: UpdateProgress) => void
  ) => Promise<void>
  /** SHA-256 of a file on disk, lowercase hex. */
  hashFile: (path: string) => Promise<string>
  /** Launch the installer. Resolving means "it started", not "it finished". */
  runInstaller: (path: string) => Promise<void>
  /** Where downloads land. Defaults to the OS temp directory. */
  downloadDir?: string
  /** Feed repository, `owner/name`. */
  repo?: string
  /** Progress sink (the IPC bridge forwards it to the renderer). */
  onProgress?: (progress: UpdateProgress) => void
  now?: () => number
}

export class UpdateService {
  private readonly deps: UpdateServiceDeps
  private readonly repo: string
  private manifest?: UpdateManifest
  private downloadedPath?: string

  constructor(deps: UpdateServiceDeps) {
    this.deps = deps
    this.repo = deps.repo ?? DEFAULT_UPDATE_REPO
  }

  /** Ask the feed for the newest release and compare it with the running version. */
  async check(): Promise<UpdateCheckResult> {
    const current = this.deps.currentVersion
    const url = `https://api.github.com/repos/${this.repo}/releases/latest`
    let payload: unknown
    try {
      const response = await this.deps.fetchImpl(url)
      if (!response.ok) {
        return {
          current,
          latest: null,
          available: false,
          reason: response.status === 404 ? 'no-release' : 'unreachable',
          message:
            response.status === 404
              ? 'The update feed has no published release yet (a private repository returns 404 to an unauthenticated check).'
              : `The update feed answered HTTP ${response.status}.`
        }
      }
      payload = JSON.parse(await response.text())
    } catch (error) {
      return {
        current,
        latest: null,
        available: false,
        reason: 'unreachable',
        message: error instanceof Error ? error.message : 'The update feed could not be reached.'
      }
    }

    const manifest = parseRelease(payload)
    if (!manifest) {
      return {
        current,
        latest: null,
        available: false,
        reason: 'unparsable',
        message: 'The newest release does not contain an installer asset.'
      }
    }

    this.manifest = manifest
    return {
      current,
      latest: manifest.version,
      available: isNewerVersion(manifest.version, current),
      manifest
    }
  }

  /**
   * Download the installer for the manifest found by `check()`.
   *
   * Verification is the point: when the release publishes `SHA256SUMS.txt`, a mismatch aborts
   * the update. Without a published digest the download is still offered (the release predates
   * the checksum file) but is reported as unverified rather than silently trusted.
   */
  async download(): Promise<UpdateDownloadResult> {
    const manifest = this.manifest
    if (!manifest) return { ok: false, error: 'Run a check first.' }

    const dir = this.deps.downloadDir ?? tmpdir()
    const fileName = decodeURIComponent(manifest.url.split('/').pop() ?? '')
    const destination = join(dir, fileName || `ai-desktop-setup-${manifest.version}.exe`)

    try {
      await this.deps.download(manifest.url, destination, (progress) =>
        this.deps.onProgress?.(progress)
      )
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'The download failed.'
      }
    }

    const expected = await this.expectedDigestFor(manifest)
    if (expected) {
      const actual = await this.deps.hashFile(destination)
      if (actual !== expected) {
        // A wrong digest means a corrupt or substituted binary: remove it rather than
        // leaving a file the user might run by hand.
        await fs.rm(destination, { force: true }).catch(() => undefined)
        return {
          ok: false,
          error: `Checksum mismatch: expected ${expected.slice(0, 16)}…, got ${actual.slice(0, 16)}…`
        }
      }
      this.downloadedPath = destination
      return { ok: true, path: destination, bytes: manifest.size, verified: true }
    }

    this.downloadedPath = destination
    return { ok: true, path: destination, bytes: manifest.size, verified: false }
  }

  /** Run the downloaded installer. The caller is responsible for quitting the app after. */
  async install(): Promise<{ ok: boolean; error?: string }> {
    if (!this.downloadedPath) return { ok: false, error: 'Nothing has been downloaded yet.' }
    try {
      await this.deps.runInstaller(this.downloadedPath)
      return { ok: true }
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'The installer could not be started.'
      }
    }
  }

  /** The manifest from the last successful `check()`, for the UI. */
  manifestForUi(): UpdateManifest | undefined {
    return this.manifest
  }

  private async expectedDigestFor(manifest: UpdateManifest): Promise<string | undefined> {
    const checksumAsset = pickChecksumFile(manifest.assets)
    if (!checksumAsset) return undefined
    try {
      const response = await this.deps.fetchImpl(checksumAsset.url)
      if (!response.ok) return undefined
      const table = parseChecksums(await response.text())
      const fileName = decodeURIComponent(manifest.url.split('/').pop() ?? '')
      return expectedDigest(table, fileName)
    } catch {
      // An unreachable checksum file must not block the update; it just stays unverified.
      return undefined
    }
  }
}

/** Default downloader: streams to disk, counting bytes. */
export async function streamToFile(
  url: string,
  destination: string,
  onProgress: (progress: UpdateProgress) => void
): Promise<void> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`)
  const totalHeader = response.headers.get('content-length')
  const total = totalHeader ? Number.parseInt(totalHeader, 10) : undefined
  if (!response.body) throw new Error('Download failed: empty response body')

  const handle = createWriteStream(destination)
  let received = 0
  const reader = response.body.getReader()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      received += value.byteLength
      if (!handle.write(Buffer.from(value))) {
        await new Promise<void>((resolve) => handle.once('drain', () => resolve()))
      }
      onProgress({ received, ...(total !== undefined ? { total } : {}) })
    }
  } finally {
    await new Promise<void>((resolve) => handle.end(() => resolve()))
  }
}

/** Default hasher used by the verification step. */
export async function sha256OfFile(path: string): Promise<string> {
  const buffer = await fs.readFile(path)
  return createHash('sha256').update(buffer).digest('hex')
}
