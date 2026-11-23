import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  FEED_REPO,
  feedAssets,
  parseArgs,
  planCommands,
  verifyFeedAssets
} from '../../scripts/publish-feed.mjs'

/*
 * P4.1 left a hole that cost seven releases: the updater reads a public feed repository and nothing published to it, so
 * 4.2.0 through 4.3.4 were invisible and an app on 4.1.0 kept saying it was current. These tests keep the script honest
 * without any network: the repository it targets, the assets it demands, the tag it builds, and — the one that matters —
 * that a version it cannot parse is refused rather than guessed.
 */
describe('the feed publication step', () => {
  it('targets the repository the updater actually reads', () => {
    expect(FEED_REPO).toBe('Arashtahmasbi3/ai-desktop-releases')
  })

  it('demands the installer, the portable build and the checksums', () => {
    expect(feedAssets('4.3.6')).toEqual([
      'release/AI Desktop Setup 4.3.6.exe',
      'release/AI Desktop 4.3.6 Portable.exe',
      'release/SHA256SUMS.txt'
    ])
  })

  it('refuses a version it cannot parse, instead of publishing a guess', () => {
    expect(parseArgs([])).toBeNull()
    expect(parseArgs(['--dry-run'])).toBeNull()
    expect(parseArgs(['v4.3.6'])).toBeNull()
    expect(parseArgs(['4.3'])).toBeNull()
    expect(parseArgs(['latest'])).toBeNull()
  })

  it('reads a plain version and the dry-run flag', () => {
    expect(parseArgs(['4.3.6'])).toEqual({ version: '4.3.6', dryRun: false, prerelease: false })
    expect(parseArgs(['4.3.6', '--dry-run'])).toEqual({ version: '4.3.6', dryRun: true, prerelease: false })
    expect(parseArgs(['4.3.6', '--prerelease'])).toEqual({ version: '4.3.6', dryRun: false, prerelease: true })
  })

  it('creates the release, then uploads each asset with --clobber so a retry is safe', () => {
    const plan = planCommands('4.3.6', 'notes')
    expect(plan).toHaveLength(4)
    expect(plan[0]?.slice(0, 3)).toEqual(['release', 'create', 'v4.3.6'])
    expect(plan[0]).toContain(FEED_REPO)
    for (const upload of plan.slice(1)) {
      expect(upload.slice(0, 3)).toEqual(['release', 'upload', 'v4.3.6'])
      expect(upload).toContain('--clobber')
      expect(upload).toContain(FEED_REPO)
    }
  })

  it('mirrors a pre-release, because the feed is what every installed app reads', () => {
    /* A build held back in the private repository must not be offered unlocked by the updater. */
    expect(planCommands('4.3.6', 'notes')[0]).not.toContain('--prerelease')
    expect(planCommands('4.3.6', 'notes', { prerelease: true })[0]).toContain('--prerelease')
  })
})

/*
 * REL-3 (v4.3.15). The step uploaded whatever sat in release/ and published the checksum file beside it without ever
 * comparing the two, so a stale installer could ship with a checksum that does not describe it.
 */
describe('the feed verifies the assets before uploading anything', () => {
  const setup = Buffer.from('setup-bytes')
  const portable = Buffer.from('portable-bytes')
  const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
  const sums = (overrides: { setup?: string; portable?: string } = {}) =>
    `${overrides.setup ?? digest(setup)}  AI Desktop Setup 4.3.6.exe\n` +
    `${overrides.portable ?? digest(portable)}  AI Desktop 4.3.6 Portable.exe\n`

  function io(files: Record<string, Buffer | Error>) {
    return {
      readFile: (path: string) => {
        const name = path.startsWith('release/') ? path.slice('release/'.length) : path
        const entry = files[name]
        if (entry === undefined || entry instanceof Error) throw entry ?? new Error('ENOENT')
        return entry
      },
      size: () => 42
    }
  }

  const files = {
    'AI Desktop Setup 4.3.6.exe': setup,
    'AI Desktop 4.3.6 Portable.exe': portable
  }

  it('accepts the pair the release just wrote', () => {
    expect(verifyFeedAssets('4.3.6', sums(), io(files))).toEqual({ ok: true, problems: [] })
  })

  it('refuses a file whose digest does not match the recorded one', () => {
    const result = verifyFeedAssets('4.3.6', sums({ portable: 'a'.repeat(64) }), io(files))
    expect(result.ok).toBe(false)
    expect(result.problems.join(' ')).toContain('does not match')
  })

  it('refuses a checksum file that does not name one of the assets', () => {
    const result = verifyFeedAssets('4.3.6', `${digest(setup)}  AI Desktop Setup 4.3.6.exe\n`, io(files))
    expect(result.ok).toBe(false)
    expect(result.problems.join(' ')).toContain('has no entry')
  })

  it('refuses when the asset is missing, instead of publishing what is not there', () => {
    const result = verifyFeedAssets('4.3.6', sums(), io({ ...files, 'AI Desktop 4.3.6 Portable.exe': new Error('ENOENT') }))
    expect(result.ok).toBe(false)
    expect(result.problems.join(' ')).toContain('cannot be read')
  })
})
