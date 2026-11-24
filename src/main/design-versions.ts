import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { designDiff, summarizeDiff } from '@shared/design-diff'
import type { DesignProject, DesignVersionSummary } from '@shared/design'

/**
 * Version history for a design (phase 4).
 *
 * Three rules make this trustworthy:
 *  1. `design.v1.json` is the first document and is never written again. It is the answer to "where did we start?".
 *  2. Every version is a whole document, not a patch. Restoring one therefore cannot depend on replaying edits.
 *  3. Restoring writes a *new* version equal to the old one; history is append-only, never rewritten.
 *
 * All of it lives beside the document (`designs/<id>/`), so a design stays a folder a user can copy.
 */

export type VersionAuthor = 'wizard' | 'board' | 'chat' | 'restore' | 'system'

export interface VersionMeta {
  by: VersionAuthor
  /** The user's own sentence, when a version came from a chat request. */
  sentence?: string
}

const VERSION_FILE = /^design\.v(\d+)\.json$/

export function versionFile(version: number): string {
  return `design.v${version}.json`
}

async function readHistory(dir: string): Promise<HistoryEntry[]> {
  try {
    const raw = await fs.readFile(join(dir, 'design-history.jsonl'), 'utf8')
    return raw
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as HistoryEntry)
  } catch {
    return []
  }
}

export interface HistoryEntry extends DesignVersionSummary {
  diff?: {
    pagesAdded: string[]
    pagesRemoved: string[]
    modulesAdded: string[]
    modulesRemoved: string[]
    modulesChanged: string[]
    edgesAdded: number
    edgesRemoved: number
  }
}

/** The highest version number on disk, or 0 when the design has never been versioned. */
export async function latestVersion(dir: string): Promise<number> {
  let entries: string[]
  try {
    entries = await fs.readdir(dir)
  } catch {
    return 0
  }
  let max = 0
  for (const entry of entries) {
    const match = VERSION_FILE.exec(entry)
    if (match) max = Math.max(max, Number(match[1]))
  }
  return max
}

export async function readVersion(dir: string, version: number): Promise<DesignProject | null> {
  try {
    const raw = await fs.readFile(join(dir, versionFile(version)), 'utf8')
    return JSON.parse(raw) as DesignProject
  } catch {
    return null
  }
}

/**
 * Write a whole document as the next version and append its history line. `previous` is only used to compute the diff
 * and may be null for the first version.
 */
export async function writeVersion(
  dir: string,
  design: DesignProject,
  meta: VersionMeta
): Promise<DesignVersionSummary> {
  const next = (await latestVersion(dir)) + 1
  if (next === 1) {
    // v1 is the baseline: written once, never overwritten.
    const exists = await readVersion(dir, 1)
    if (exists) throw new Error('نسخهٔ اول قفل است و بازنویسی نمی‌شود.')
  }

  const previous = next > 1 ? await readVersion(dir, next - 1) : null
  const diff = previous ? designDiff(previous, design) : undefined
  const summary = diff ? summarizeDiff(diff) : 'نسخهٔ اولیه'
  const at = design.updatedAt || Date.now()

  await fs.writeFile(join(dir, versionFile(next)), `${JSON.stringify(design, null, 2)}\n`, 'utf8')
  const entry: HistoryEntry = {
    version: next,
    at,
    by: meta.by,
    summary,
    ...(meta.sentence ? { sentence: meta.sentence } : {}),
    ...(diff ? { diff } : {})
  }
  await fs.appendFile(join(dir, 'design-history.jsonl'), `${JSON.stringify(entry)}\n`, 'utf8')
  return entry
}

/** Newest first, so the panel's first row is what just happened. */
export async function listVersions(dir: string): Promise<DesignVersionSummary[]> {
  const history = await readHistory(dir)
  const latest = await latestVersion(dir)
  const known = new Map(history.map((entry) => [entry.version, entry]))
  const versions: DesignVersionSummary[] = []
  for (let version = latest; version >= 1; version -= 1) {
    const entry = known.get(version)
    versions.push({
      version,
      at: entry?.at ?? 0,
      by: entry?.by ?? 'system',
      summary: entry?.summary ?? ''
    })
  }
  return versions
}
