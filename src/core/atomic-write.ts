/**
 * Atomic file writes (v2.6.5).
 *
 * Every store in this app wrote its JSON through a hand-rolled
 * `write temp -> rename` pair whose temp name was `${file}.${pid}.${Date.now()}.tmp`.
 * That had two real consequences:
 *
 * 1. **Orphaned temp files.** `fs.rename` was the only statement that removed the
 *    temp file, and on Windows `MoveFileEx(MOVEFILE_REPLACE_EXISTING)` fails with
 *    `EPERM`/`EACCES` whenever the destination is briefly held by another process
 *    (Defender, the search indexer). Nothing retried and nothing cleaned up, so
 *    every transient failure leaked a full copy of the file permanently — the
 *    audit log alone left **822 files / 361.8 MB** in four days, and its
 *    `catch {}` meant the audit trail had silently stopped being written.
 * 2. **Collisions.** The name was only millisecond-resolved while writers ran
 *    concurrently, so two saves in the same millisecond shared one temp path: one
 *    rename won, the loser raised `ENOENT`, and a late `writeFile` could interleave
 *    two JSON documents into the real file.
 *
 * This module fixes both: a unique temp name, a bounded rename retry for the
 * Windows sharing violation, an unconditional unlink on the error path, and a
 * per-target promise chain so concurrent saves are serialised.
 */
import { promises as fs } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'

/** How many times a `rename` is retried while Windows holds the destination. */
const RENAME_ATTEMPTS = 5
/** Base backoff; grows linearly per attempt. */
const RENAME_BACKOFF_MS = 40

/** Retryable sharing violations (Windows) and busy handles. */
const RETRYABLE_RENAME_CODES = new Set(['EPERM', 'EACCES', 'EBUSY', 'EEXIST'])

/** One pending write chain per target file, so concurrent saves serialise. */
const writeChains = new Map<string, Promise<void>>()

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Unique temp path next to `file`, safe for concurrent writers. */
export function tempPathFor(file: string): string {
  return `${file}.${process.pid}.${randomUUID()}.tmp`
}

async function renameWithRetry(from: string, to: string): Promise<void> {
  let lastError: unknown
  for (let attempt = 0; attempt < RENAME_ATTEMPTS; attempt += 1) {
    try {
      await fs.rename(from, to)
      return
    } catch (error) {
      lastError = error
      const code = (error as NodeJS.ErrnoException).code ?? ''
      if (!RETRYABLE_RENAME_CODES.has(code)) throw error
      await delay(RENAME_BACKOFF_MS * (attempt + 1))
    }
  }
  throw lastError
}

/**
 * Write `content` to `file` atomically: a unique temp file in the same directory,
 * then a retried rename. The temp file is removed on every failure path, so a
 * transient error can no longer leak a copy of the file.
 *
 * Writes to the same target are serialised, which also removes the torn-file
 * risk that came from two concurrent read-modify-write saves.
 */
export async function writeFileAtomic(file: string, content: string): Promise<void> {
  const previous = writeChains.get(file)
  const task = async (): Promise<void> => {
    await fs.mkdir(dirname(file), { recursive: true })
    const tmp = tempPathFor(file)
    try {
      await fs.writeFile(tmp, content, 'utf8')
      await renameWithRetry(tmp, file)
    } catch (error) {
      await fs.unlink(tmp).catch(() => undefined)
      throw error
    }
  }

  const run = previous ? previous.then(task, task) : task()
  const guarded = run.then(
    () => undefined,
    () => undefined
  )
  writeChains.set(file, guarded)
  void guarded.then(() => {
    if (writeChains.get(file) === guarded) writeChains.delete(file)
  })
  return run
}

/**
 * Delete leftover `<file>.*.tmp` siblings (v2.6.5). Existing installs already
 * carry hundreds of them from the old writer, so every store sweeps its own
 * directory at startup. Files newer than `olderThanMs` are left alone in case a
 * write is genuinely in flight.
 */
export async function sweepStaleTempFiles(file: string, olderThanMs = 60_000): Promise<number> {
  const dir = dirname(file)
  const prefix = `${basename(file)}.`
  const cutoff = Date.now() - olderThanMs
  let removed = 0
  let entries: string[]
  try {
    entries = await fs.readdir(dir)
  } catch {
    return 0
  }
  for (const entry of entries) {
    if (!entry.startsWith(prefix) || !entry.endsWith('.tmp') || entry === basename(file)) continue
    const target = join(dir, entry)
    try {
      const stats = await fs.stat(target)
      if (stats.mtimeMs > cutoff) continue
      await fs.unlink(target)
      removed += 1
    } catch {
      // Another process may have removed it; nothing to do.
    }
  }
  return removed
}
