import { describe, expect, it } from 'vitest'
import { FEED_REPO, feedAssets, parseArgs, planCommands } from '../../scripts/publish-feed.mjs'

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
