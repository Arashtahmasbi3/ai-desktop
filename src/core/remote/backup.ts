/**
 * Backups taken before a destructive remote write (v2.3.2, B.1).
 *
 * Before overwriting an existing file we copy it next to itself as
 * `<path>.backup-<timestamp>`, so a bad agent write can always be undone.
 * Pure helpers so the naming/parsing can be tested without SSH.
 */

export const BACKUP_SUFFIX = '.backup-'

/** The backup path for `path` taken at `now`. */
export function backupPathFor(path: string, now: number = Date.now()): string {
  return `${path}${BACKUP_SUFFIX}${now}`
}

/** True when a path looks like one of our backups. */
export function isBackupPath(path: string): boolean {
  return parseBackupPath(path) !== null
}

/** Recover the original path and timestamp from a backup path. */
export function parseBackupPath(path: string): { original: string; at: number } | null {
  const index = path.lastIndexOf(BACKUP_SUFFIX)
  if (index <= 0) return null
  const at = Number(path.slice(index + BACKUP_SUFFIX.length))
  if (!Number.isFinite(at)) return null
  return { original: path.slice(0, index), at }
}

/** The shell command that restores a backup over its original path. */
export function restoreCommandFor(backupPath: string, shellQuote: (v: string) => string): string | null {
  const parsed = parseBackupPath(backupPath)
  if (!parsed) return null
  return `cp -p -- ${shellQuote(backupPath)} ${shellQuote(parsed.original)}`
}
