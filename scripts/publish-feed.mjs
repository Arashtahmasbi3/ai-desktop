/**
 * Publish an already-built release to the updater's feed repository.
 *
 * Why this file exists: the updater reads `Arashtahmasbi3/ai-desktop-releases` (`DEFAULT_UPDATE_REPO` in
 * `src/main/updater.ts`), while `scripts/release.mjs` publishes only to the private repository. Nothing closed that gap,
 * so every version from 4.2.0 to 4.3.4 shipped and was invisible to in-app update: `/releases/latest` still answered
 * `v4.1.0`, and an app on 4.1.0 told its user it was up to date. That is the failure this script prevents — not by
 * remembering, by being a step someone can run and a test that keeps it honest.
 *
 * It is deliberately separate from `release.mjs`: the release path is load-bearing and audited, and a network step that
 * uploads ~107 MB twice has no business inside it. Run this after the private release exists.
 *
 *   node scripts/publish-feed.mjs 4.3.6 [--prerelease] [--dry-run]
 *
 * Required: `gh` on PATH, authenticated, with write access to the feed repo. Assets come from `release/`:
 * `AI Desktop Setup <v>.exe`, `AI Desktop <v> Portable.exe`, `SHA256SUMS.txt`.
 */

/** The repository the app's updater reads. Kept in sync with `DEFAULT_UPDATE_REPO`. */
export const FEED_REPO = 'Arashtahmasbi3/ai-desktop-releases'

/** The assets a feed release must carry, in the order they are uploaded. */
export function feedAssets(version) {
  return [
    `release/AI Desktop Setup ${version}.exe`,
    `release/AI Desktop ${version} Portable.exe`,
    'release/SHA256SUMS.txt'
  ]
}

/**
 * Parse the command line. Returns `null` for a version that is not a plain SemVer, because publishing the wrong tag to
 * the feed is worse than failing: the updater compares versions numerically and a stray tag could become "latest".
 */
export function parseArgs(argv) {
  const version = argv.find((arg) => !arg.startsWith('--'))
  if (!version || !/^\d+\.\d+\.\d+$/.test(version)) return null
  return { version, dryRun: argv.includes('--dry-run'), prerelease: argv.includes('--prerelease') }
}

/** The `gh` invocations, as data, so a test can assert them without running anything. */
export function planCommands(version, notes, options = {}) {
  const tag = 'v' + version
  const create = ['release', 'create', tag, '--repo', FEED_REPO, '--title', 'AI Desktop ' + version, '--notes', notes]
  /*
   * The feed must mirror the state of the release it copies. A pre-release held back in the private repository and
   * published unlocked here is how every installed app gets offered a build nobody promoted.
   */
  if (options.prerelease) create.push('--prerelease')
  return [
    create,
    ...feedAssets(version).map((asset) => ['release', 'upload', tag, asset, '--repo', FEED_REPO, '--clobber'])
  ]
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2))
  if (!parsed) {
    console.error('usage: node scripts/publish-feed.mjs <x.y.z> [--prerelease] [--dry-run]')
    process.exit(2)
  }
  const { version, dryRun, prerelease } = parsed
  const notes =
    'The updater feed. See the private repository Arashtahmasbi3/ai-desktop for the release notes of v' +
    version +
    '.'
  const commands = planCommands(version, notes, { prerelease })
  for (const command of commands) {
    console.log((dryRun ? '[dry-run] ' : '') + 'gh ' + command.join(' '))
  }
  if (dryRun) return
  const { spawnSync } = await import('node:child_process')
  for (const command of commands) {
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const result = spawnSync('gh', command, { stdio: 'inherit' })
      if (result.status === 0) break
      if (attempt === 4) {
        console.error('failed after four attempts: gh ' + command.join(' '))
        process.exit(1)
      }
      console.error('retry ' + attempt + ': gh ' + command[1] + ' ' + command[2])
      await new Promise((resolve) => setTimeout(resolve, 10_000))
    }
  }
  console.log('published v' + version + ' to ' + FEED_REPO + (prerelease ? ' (pre-release)' : ''))
}

if (process.argv[1] && process.argv[1].endsWith('publish-feed.mjs')) {
  await main()
}
