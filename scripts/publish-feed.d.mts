/** The repository the updater reads; kept in sync with DEFAULT_UPDATE_REPO in src/main/updater.ts. */
export const FEED_REPO: string

/** The assets a feed release must carry, in upload order. */
export function feedAssets(version: string): string[]

/** Parse argv; `null` for a version that is not a plain SemVer, because publishing a wrong tag is worse than failing. */
export function parseArgs(argv: string[]): { version: string; dryRun: boolean; prerelease: boolean } | null

/**
 * The `gh` invocations as data, so a test can assert them without running anything. `prerelease` must mirror the private
 * release's flag: the feed is what every installed app reads, so an unmarked copy would offer a held-back build.
 */
export function planCommands(
  version: string,
  notes: string,
  options?: { prerelease?: boolean }
): string[][]
