/**
 * One verdict for a whole migration — S5.3.
 *
 * A migration produces two verifications that are easy to read separately and easy to misread
 * together: the file comparison (S4.5) proves the tree arrived, and the database comparison (S5.1)
 * proves the data inside it arrived. "Files match" alone is a green tick over a database that was
 * never restored, so the two are composed into a single report the UI renders in one place.
 *
 * The composition is deliberately pessimistic about *coverage* and optimistic about *failure*:
 * a missing half is not a failure (`ok` only judges what was actually compared) but it is not
 * coverage either (`complete` says whether both halves were compared at all).
 */

import type { MigrationVerification } from './migration'
import type { DatabaseVerification } from './database-migration'

export interface MigrationReport {
  /** True when every verification that exists agrees. A half that was never run cannot fail. */
  ok: boolean
  /** True only when both halves were compared. `ok` with `complete: false` is not a clean bill. */
  complete: boolean
  files?: MigrationVerification | undefined
  database?: DatabaseVerification | undefined
  summary: string
  /** One sentence per disagreement, so the surface can list them instead of blaming "the migration". */
  mismatches: string[]
}

function filesLine(files: MigrationVerification | undefined): string {
  if (files === undefined) return 'Files: not compared yet.'
  return `Files: ${files.ok ? 'match' : 'MISMATCH'} — ${files.message}`
}

function databaseLine(database: DatabaseVerification | undefined): string {
  if (database === undefined) return 'Database: not compared yet.'
  return `Database: ${database.ok ? 'match' : 'MISMATCH'} — ${database.message}`
}

export function combineVerifications(
  files?: MigrationVerification | undefined,
  database?: DatabaseVerification | undefined
): MigrationReport {
  const mismatches: string[] = []
  if (files !== undefined && !files.ok) mismatches.push(files.message)
  if (database !== undefined) mismatches.push(...database.mismatches)
  if (database !== undefined && !database.ok && database.mismatches.length === 0) {
    mismatches.push(database.message)
  }
  const ok = (files?.ok ?? true) && (database?.ok ?? true)
  return {
    ok,
    complete: files !== undefined && database !== undefined,
    ...(files === undefined ? {} : { files }),
    ...(database === undefined ? {} : { database }),
    summary: `${filesLine(files)} ${databaseLine(database)}`,
    mismatches
  }
}
