/** The repository the updater reads; kept in sync with DEFAULT_UPDATE_REPO in src/main/updater.ts. */
export const FEED_REPO: string

/** The assets a feed release must carry, in upload order. */
export function feedAssets(version: string): string[]

/** Parse argv; `null` for a version that is not a plain SemVer, because publishing a wrong tag is worse than failing. */
export function parseArgs(argv: string[]): { version: string; dryRun: boolean } | null

/** The `gh` invocations as data, so a test can assert them without running anything. */
export function planCommands(version: string, notes: string): string[][]
