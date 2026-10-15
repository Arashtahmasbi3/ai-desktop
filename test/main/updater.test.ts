import { describe, expect, it } from 'vitest'
import {
  compareVersions,
  describeCheck,
  expectedDigest,
  isNewerVersion,
  parseChecksums,
  parseRelease,
  parseVersion,
  pickChecksumFile,
  pickInstaller
} from '../../src/shared/update'
import { UpdateService, type UpdateServiceDeps } from '../../src/main/updater'

/**
 * Auto-update (v3.0). The user reported "no auto-update" and the app genuinely had none.
 *
 * Two classes of mistake matter here and both are silent:
 *  - a **wrong version comparison**, which either hides a real update forever or offers a
 *    downgrade as an "update";
 *  - an **unverified binary**, because running an installer downloaded from the internet
 *    without checking the published digest is the whole risk of an updater.
 *
 * Everything is injected, so these tests never touch the network, the disk or Electron.
 */
const CHECKSUMS = [
  'db09b04c703b19e099e44dd002679581c0786ba17e9e74742e8807c0bd10cfc6  AI Desktop Setup 3.0.0.exe',
  '591dc03a1344433ba9f31bb57e1ea6b0695ecb322eec06fae6be84537b6f3d3a  AI Desktop 3.0.0 Portable.exe'
].join('\n')

function releaseBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    tag_name: 'v3.0.0',
    body: 'the notes',
    published_at: '2026-10-16T00:00:00Z',
    assets: [
      {
        name: 'AI Desktop Setup 3.0.0.exe',
        size: 112519897,
        browser_download_url: 'https://example.test/AI%20Desktop%20Setup%203.0.0.exe'
      },
      {
        name: 'SHA256SUMS.txt',
        size: 189,
        browser_download_url: 'https://example.test/SHA256SUMS.txt'
      },
      {
        name: 'AI Desktop 3.0.0 Portable.exe',
        size: 112237622,
        browser_download_url: 'https://example.test/portable.exe'
      }
    ],
    ...overrides
  }
}

describe('version comparison (v3.0)', () => {
  it('parses a leading v and ignores a pre-release suffix', () => {
    expect(parseVersion('v3.0.1')).toEqual([3, 0, 1])
    expect(parseVersion('3.0.1-beta.2')).toEqual([3, 0, 1])
    expect(parseVersion('nonsense')).toEqual([0, 0, 0])
  })

  it('orders versions numerically, not as strings', () => {
    // The classic bug: "3.10.0" < "3.9.0" when compared as text.
    expect(compareVersions('3.10.0', '3.9.0')).toBe(1)
    expect(compareVersions('3.0.0', '3.0.0')).toBe(0)
    expect(compareVersions('2.9.2', '3.0.0')).toBe(-1)
  })

  it('treats a shorter version as the same release with zeroes', () => {
    expect(compareVersions('3.0', '3.0.0')).toBe(0)
    expect(compareVersions('3.0.1', '3.0')).toBe(1)
  })

  it('only offers a strictly newer version', () => {
    expect(isNewerVersion('3.0.1', '3.0.0')).toBe(true)
    expect(isNewerVersion('3.0.0', '3.0.0')).toBe(false)
    // A draft/older tag must never be presented as an update, or the user downgrades.
    expect(isNewerVersion('2.9.2', '3.0.0')).toBe(false)
  })
})

describe('release parsing (v3.0)', () => {
  it('picks the installer, not the portable exe or the checksum file', () => {
    const manifest = parseRelease(releaseBody())
    expect(manifest?.version).toBe('3.0.0')
    expect(manifest?.url).toContain('Setup')
    expect(manifest?.size).toBe(112519897)
    expect(manifest?.notes).toBe('the notes')
    expect(manifest?.assets).toHaveLength(3)
  })

  it('refuses a release with no installer asset', () => {
    const manifest = parseRelease(
      releaseBody({ assets: [{ name: 'source.zip', browser_download_url: 'https://x/s.zip' }] })
    )
    // A manifest pointing at a source archive would be worse than no update at all.
    expect(manifest).toBeUndefined()
  })

  it('survives junk from the network', () => {
    expect(parseRelease(null)).toBeUndefined()
    expect(parseRelease('nope')).toBeUndefined()
    expect(parseRelease({ tag_name: '' })).toBeUndefined()
    expect(parseRelease({ tag_name: 'v1.0.0', assets: [null, 42, {}] })).toBeUndefined()
  })

  it('finds the checksum file and the installer case-insensitively', () => {
    const assets = [
      { name: 'ai desktop setup 3.0.0.EXE', url: 'https://x/a' },
      { name: 'sha256sums.txt', url: 'https://x/b' }
    ]
    expect(pickInstaller(assets)?.url).toBe('https://x/a')
    expect(pickChecksumFile(assets)?.url).toBe('https://x/b')
  })

  it('parses a checksum table and matches a GitHub-renamed asset', () => {
    const table = parseChecksums(CHECKSUMS)
    expect(Object.keys(table)).toHaveLength(2)
    // GitHub replaces spaces with dots in uploaded asset names; the digest must still match.
    expect(expectedDigest(table, 'AI.Desktop.Setup.3.0.0.exe')).toBe(
      'db09b04c703b19e099e44dd002679581c0786ba17e9e74742e8807c0bd10cfc6'
    )
    expect(expectedDigest(table, 'unknown.exe')).toBeUndefined()
  })

  it('describes each outcome in words the UI can show', () => {
    expect(describeCheck({ current: '1.0.0', latest: '1.1.0', available: true })).toContain('1.1.0')
    expect(describeCheck({ current: '1.0.0', latest: null, available: false })).toBe(
      'You are up to date'
    )
    expect(
      describeCheck({ current: '1.0.0', latest: null, available: false, reason: 'no-release' })
    ).toContain('No usable release')
  })
})

/** A deps stub with recording boundaries. */
function deps(overrides: Partial<UpdateServiceDeps> = {}): {
  deps: UpdateServiceDeps
  fetched: string[]
  progress: number[]
  ran: string[]
} {
  const fetched: string[] = []
  const progress: number[] = []
  const ran: string[] = []
  const base: UpdateServiceDeps = {
    currentVersion: '2.9.2',
    fetchImpl: async (url: string) => {
      fetched.push(url)
      if (url.endsWith('SHA256SUMS.txt')) {
        return { ok: true, status: 200, text: async () => CHECKSUMS }
      }
      return { ok: true, status: 200, text: async () => JSON.stringify(releaseBody()) }
    },
    download: async (_url, _destination, onProgress) => {
      onProgress({ received: 10, total: 100 })
      onProgress({ received: 100, total: 100 })
    },
    hashFile: async () => 'db09b04c703b19e099e44dd002679581c0786ba17e9e74742e8807c0bd10cfc6',
    runInstaller: async (path: string) => {
      ran.push(path)
    },
    downloadDir: undefined as unknown as string,
    onProgress: (p) => progress.push(p.received),
    ...overrides
  }
  return { deps: base, fetched, progress, ran }
}

describe('UpdateService (v3.0)', () => {
  it('reports an available update and its notes', async () => {
    const { deps: d, fetched } = deps()
    const service = new UpdateService(d)

    const result = await service.check()

    expect(result.available).toBe(true)
    expect(result.latest).toBe('3.0.0')
    expect(result.current).toBe('2.9.2')
    expect(result.manifest?.notes).toBe('the notes')
    expect(fetched[0]).toContain('api.github.com/repos/Arashtahmasbi3/ai-desktop/releases/latest')
  })

  it('does not offer the same or an older release', async () => {
    const { deps: d } = deps({ currentVersion: '3.0.0' })
    expect((await new UpdateService(d).check()).available).toBe(false)
  })

  it('explains a 404 instead of pretending there is no update', async () => {
    // A private repository answers 404 to an unauthenticated check — the likely state today,
    // and the user must be told why rather than shown a reassuring "up to date".
    const { deps: d } = deps({
      fetchImpl: async () => ({ ok: false, status: 404, text: async () => '' })
    })
    const result = await new UpdateService(d).check()
    expect(result.available).toBe(false)
    expect(result.reason).toBe('no-release')
    expect(result.message).toContain('private')
  })

  it('survives a feed that is unreachable or returns junk', async () => {
    const throwing = deps({
      fetchImpl: async () => {
        throw new Error('getaddrinfo ENOTFOUND')
      }
    })
    expect((await new UpdateService(throwing.deps).check()).reason).toBe('unreachable')

    const junk = deps({ fetchImpl: async () => ({ ok: true, status: 200, text: async () => 'not json' }) })
    expect((await new UpdateService(junk.deps).check()).reason).toBe('unreachable')

    const noInstaller = deps({
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ tag_name: 'v9.9.9', assets: [] })
      })
    })
    expect((await new UpdateService(noInstaller.deps).check()).reason).toBe('unparsable')
  })

  it('downloads, verifies against the published digest and reports progress', async () => {
    const { deps: d, progress, fetched } = deps()
    const service = new UpdateService(d)
    await service.check()

    const result = await service.download()

    expect(result.ok).toBe(true)
    expect(result.verified).toBe(true)
    expect(progress).toEqual([10, 100])
    // The checksum file is fetched from the same release, not a hardcoded copy.
    expect(fetched.some((url) => url.endsWith('SHA256SUMS.txt'))).toBe(true)
  })

  it('refuses an installer whose digest does not match, and does not keep the file', async () => {
    const { deps: d } = deps({ hashFile: async () => 'deadbeef'.repeat(8) })
    const service = new UpdateService(d)
    await service.check()

    const result = await service.download()

    expect(result.ok).toBe(false)
    expect(result.error).toContain('Checksum mismatch')
    // And nothing can be installed afterwards.
    expect((await service.install()).ok).toBe(false)
  })

  it('still offers the download when the release predates the checksum file', async () => {
    const { deps: d } = deps({
      fetchImpl: async (url: string) => {
        if (url.endsWith('SHA256SUMS.txt')) return { ok: false, status: 404, text: async () => '' }
        return { ok: true, status: 200, text: async () => JSON.stringify(releaseBody()) }
      }
    })
    const service = new UpdateService(d)
    await service.check()

    const result = await service.download()
    // Offered, but reported honestly as unverified rather than silently trusted.
    expect(result.ok).toBe(true)
    expect(result.verified).toBe(false)
  })

  it('reports a failed download instead of throwing', async () => {
    const { deps: d } = deps({
      download: async () => {
        throw new Error('socket hang up')
      }
    })
    const service = new UpdateService(d)
    await service.check()

    const result = await service.download()
    expect(result.ok).toBe(false)
    expect(result.error).toContain('socket hang up')
  })

  it('will not install before a download', async () => {
    const { deps: d, ran } = deps()
    const service = new UpdateService(d)
    await service.check()
    const result = await service.install()
    expect(result.ok).toBe(false)
    expect(ran).toEqual([])
  })

  it('runs the installer only after a verified download', async () => {
    const { deps: d, ran } = deps()
    const service = new UpdateService(d)
    await service.check()
    await service.download()

    expect((await service.install()).ok).toBe(true)
    expect(ran).toHaveLength(1)
    expect(ran[0]).toContain('AI Desktop Setup 3.0.0.exe')
  })

  it('requires a check before a download', async () => {
    const { deps: d } = deps()
    const result = await new UpdateService(d).download()
    expect(result.ok).toBe(false)
    expect(result.error).toContain('check')
  })
})
