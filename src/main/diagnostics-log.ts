import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { redactValue } from '@core/agent/redact'

/**
 * Local diagnostics (T21).
 *
 * There is **no upload**. The checklist's item was telemetry, and the honest version of that for this app is a file the
 * user can read: one JSON line per run, with no prompt text and no credentials, written only when the user turns the
 * setting on. Anything that leaves the machine is a product decision that has not been made.
 *
 * The record is deliberately poor in personal data: run id, status, provider and model, token counts, step count,
 * warnings count and duration. The task itself is reduced to a length — enough to spot "long runs fail", not enough to
 * read somebody's conversation.
 */
export interface DiagnosticsEntry {
  at: number
  runId: string
  status: string
  provider?: string
  model?: string
  promptTokens?: number
  completionTokens?: number
  steps?: number
  warnings?: number
  durationMs?: number
  taskChars?: number
}

export interface DiagnosticsLogOptions {
  dir: string
  now?: () => number
  /** Rotate to `.1.jsonl` past this size. */
  maxBytes?: number
}

export const DEFAULT_MAX_DIAGNOSTICS_BYTES = 2_000_000

export class DiagnosticsLog {
  private readonly file: string
  private readonly rotated: string
  private readonly now: () => number
  private readonly maxBytes: number

  constructor(options: DiagnosticsLogOptions) {
    this.file = join(options.dir, 'diagnostics.jsonl')
    this.rotated = join(options.dir, 'diagnostics.1.jsonl')
    this.now = options.now ?? Date.now
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_DIAGNOSTICS_BYTES
  }

  /** Append one record. Redaction runs on the way in, so a provider id or a header cannot smuggle a secret into the file. */
  async record(entry: Omit<DiagnosticsEntry, 'at'>): Promise<void> {
    const record: DiagnosticsEntry = redactValue({ at: this.now(), ...entry })
    await this.rotateIfNeeded()
    await fs.appendFile(this.file, `${JSON.stringify(record)}\n`, 'utf8')
  }

  private async rotateIfNeeded(): Promise<void> {
    try {
      const stat = await fs.stat(this.file)
      if (stat.size < this.maxBytes) return
      await fs.rm(this.rotated, { force: true })
      await fs.rename(this.file, this.rotated)
    } catch {
      // A missing file needs no rotation.
    }
  }
}

/**
 * A short human summary of the local log, for a support conversation: runs, failures and the slowest run. Reads at most
 * the last `limit` lines.
 */
export async function summarizeDiagnostics(dir: string, limit = 500): Promise<string> {
  let raw: string
  try {
    raw = await fs.readFile(join(dir, 'diagnostics.jsonl'), 'utf8')
  } catch {
    return 'لاگ محلی خالی است.'
  }
  const entries: DiagnosticsEntry[] = []
  for (const line of raw.split('\n').filter(Boolean).slice(-limit)) {
    try {
      entries.push(JSON.parse(line) as DiagnosticsEntry)
    } catch {
      // Skip a half-written line rather than failing the summary.
    }
  }
  if (entries.length === 0) return 'لاگ محلی خالی است.'
  const failures = entries.filter((entry) => entry.status !== 'completed').length
  const slowest = entries.reduce((worst, entry) => Math.max(worst, entry.durationMs ?? 0), 0)
  return `${entries.length} اجرا · ${failures} ناموفق · کندترین ${Math.round(slowest / 1000)} ثانیه`
}
