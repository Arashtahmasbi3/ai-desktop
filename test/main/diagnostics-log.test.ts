import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DiagnosticsLog, summarizeDiagnostics } from '../../src/main/diagnostics-log'

/**
 * T21 — local diagnostics.
 *
 * The promises: nothing is written unless asked, the record carries no prompt text and no secret, the file rotates instead
 * of growing for ever, and the summary survives a half-written line.
 */
let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'diagnostics-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('DiagnosticsLog (T21)', () => {
  it('writes one JSON line per record', async () => {
    const log = new DiagnosticsLog({ dir, now: () => 1_000 })
    await log.record({ runId: 'r1', status: 'completed', provider: 'deepseek', steps: 4, taskChars: 120 })

    const lines = (await readFile(join(dir, 'diagnostics.jsonl'), 'utf8')).trim().split('\n')
    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0]!)).toMatchObject({ at: 1_000, runId: 'r1', taskChars: 120 })
  })

  it('never stores the prompt text, only its length', async () => {
    const log = new DiagnosticsLog({ dir })
    await log.record({ runId: 'r1', status: 'completed', taskChars: 42 })

    const raw = await readFile(join(dir, 'diagnostics.jsonl'), 'utf8')
    expect(raw).not.toContain('prompt')
    expect(raw).toContain('taskChars')
  })

  it('redacts a secret that reaches the record', async () => {
    const log = new DiagnosticsLog({ dir })
    await log.record({ runId: 'r1', status: 'error', provider: 'sk-abcdef1234567890' })

    const raw = await readFile(join(dir, 'diagnostics.jsonl'), 'utf8')
    expect(raw).not.toContain('sk-abcdef1234567890')
  })

  it('rotates instead of growing past the cap', async () => {
    const log = new DiagnosticsLog({ dir, maxBytes: 120 })
    await log.record({ runId: 'r1', status: 'completed', provider: 'deepseek', steps: 1 })
    await log.record({ runId: 'r2', status: 'completed', provider: 'deepseek', steps: 1 })
    await log.record({ runId: 'r3', status: 'completed', provider: 'deepseek', steps: 1 })

    expect((await stat(join(dir, 'diagnostics.1.jsonl'))).size).toBeGreaterThan(0)
    expect((await stat(join(dir, 'diagnostics.jsonl'))).size).toBeLessThan(300)
  })
})

describe('summarizeDiagnostics (T21)', () => {
  it('says the log is empty when there is none', async () => {
    expect(await summarizeDiagnostics(dir)).toContain('خالی')
  })

  it('counts runs, failures and the slowest run, skipping a broken line', async () => {
    await writeFile(
      join(dir, 'diagnostics.jsonl'),
      `${JSON.stringify({ at: 1, runId: 'a', status: 'completed', durationMs: 2_000 })}\n{broken\n${JSON.stringify({ at: 2, runId: 'b', status: 'failed', durationMs: 9_000 })}\n`,
      'utf8'
    )

    const summary = await summarizeDiagnostics(dir)
    expect(summary).toContain('2 اجرا')
    expect(summary).toContain('1 ناموفق')
    expect(summary).toContain('9 ثانیه')
  })
})
