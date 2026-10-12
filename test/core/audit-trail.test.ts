/**
 * v2.6.2 Topic 3, T3.3 - audit mode.
 *
 * These tests exercise the real file: we write lines, restart the trail, verify
 * the chain, then tamper with the file on disk and prove verify() catches it.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  AuditTrail,
  auditFileFor,
  auditLineFromDecision,
  auditLineFromPreflightOverride,
  canonicalJson,
  GENESIS_HASH
} from '@core/agent/audit-trail'
import type { TraceDecision } from '@shared/trace'
import { redactValue } from '@core/agent/redact'

let dir: string
let file: string

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'audit-trail-'))
  file = join(dir, 'audit.log')
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

function entry(overrides: Record<string, unknown> = {}) {
  return {
    projectId: 'p1',
    vpsId: '',
    runId: 'run-1',
    phase: 'executing' as const,
    approval: 'not_required' as const,
    result: 'ok' as const,
    ...overrides
  }
}

async function lines(): Promise<Record<string, unknown>[]> {
  const raw = await fs.readFile(file, 'utf8')
  return raw
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>)
}

describe('canonicalJson', () => {
  it('is stable regardless of key order', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }))
  })
})

describe('AuditTrail', () => {
  it('appends JSONL and numbers lines from 1 with the genesis hash first', async () => {
    const trail = new AuditTrail({ file, userId: 'tester', now: () => new Date(1000) })
    const first = await trail.append(entry())
    const second = await trail.append(entry({ runId: 'run-2' }))

    expect(first.seq).toBe(1)
    expect(first.prevHash).toBe(GENESIS_HASH)
    expect(second.seq).toBe(2)
    expect(second.prevHash).toBe(first.hash)
    expect(first.userId).toBe('tester')
    expect((await lines())).toHaveLength(2)
  })

  it('serializes concurrent appends so sequence numbers never collide', async () => {
    const trail = new AuditTrail({ file })
    const appended = await Promise.all([
      trail.append(entry()),
      trail.append(entry()),
      trail.append(entry()),
      trail.append(entry())
    ])

    expect(appended.map((line) => line.seq)).toEqual([1, 2, 3, 4])
    expect((await trail.verify())).toEqual({ ok: true, lines: 4 })
  })

  it('continues an existing chain after a restart', async () => {
    const first = new AuditTrail({ file })
    await first.append(entry())
    await first.append(entry())

    const restarted = new AuditTrail({ file })
    const third = await restarted.append(entry({ runId: 'run-3' }))

    expect(third.seq).toBe(3)
    expect((await restarted.verify()).ok).toBe(true)
  })

  it('verifies an intact chain, including an empty/missing file', async () => {
    const missing = new AuditTrail({ file })
    expect(await missing.verify()).toEqual({ ok: true, lines: 0 })

    await missing.append(entry())
    await missing.append(entry())
    expect(await missing.verify()).toEqual({ ok: true, lines: 2 })
  })

  it('detects an edited line', async () => {
    const trail = new AuditTrail({ file })
    await trail.append(entry())
    await trail.append(entry())

    const raw = await lines()
    raw[0].result = 'failed'
    await fs.writeFile(file, `${raw.map((line) => JSON.stringify(line)).join('\n')}\n`, 'utf8')

    const result = await trail.verify()
    expect(result.ok).toBe(false)
    expect(result.brokenAt).toBe(0)
    expect(result.reason).toBe('hash mismatch')
  })

  it('detects reordered lines', async () => {
    const trail = new AuditTrail({ file })
    await trail.append(entry({ projectId: 'a' }))
    await trail.append(entry({ projectId: 'b' }))

    const raw = await lines()
    await fs.writeFile(file, `${JSON.stringify(raw[1])}\n${JSON.stringify(raw[0])}\n`, 'utf8')

    const result = await trail.verify()
    expect(result.ok).toBe(false)
    expect(result.brokenAt).toBe(0)
  })

  it('detects a dropped line', async () => {
    const trail = new AuditTrail({ file })
    await trail.append(entry())
    await trail.append(entry())
    await trail.append(entry())

    const raw = await lines()
    await fs.writeFile(file, `${JSON.stringify(raw[0])}\n${JSON.stringify(raw[2])}\n`, 'utf8')

    const result = await trail.verify()
    expect(result.ok).toBe(false)
    expect(result.brokenAt).toBe(1)
    expect(result.reason).toBe('sequence gap')
  })

  it('redacts secrets before they reach the disk', async () => {
    const trail = new AuditTrail({ file, redact: (line) => redactValue(line) })
    await trail.append(entry({ command: 'curl -H "Authorization: Bearer sk-abcdefghijklmnop1234"' }))

    const raw = await fs.readFile(file, 'utf8')
    expect(raw).not.toContain('sk-abcdefghijklmnop1234')
    expect(raw).toContain('[REDACTED]')
    // The redacted content is what the hash commits to, so verify still passes.
    expect((await trail.verify()).ok).toBe(true)
  })
})

describe('auditFileFor', () => {
  it('keeps a local project audit under its own root', () => {
    expect(auditFileFor({ id: 'p1', path: '/work/app', type: 'local' }, '/data')).toBe(
      '/work/app/.ai-desktop/audit.log'
    )
  })

  it('keeps a remote project audit in app-data, never on the VPS', () => {
    expect(auditFileFor({ id: 'p2', path: '/srv/app', type: 'remote' }, '/data')).toBe(
      '/data/projects/p2/audit.log'
    )
    expect(auditFileFor({ id: 'p2', path: '/srv/app', type: 'remote' }, 'C:\\data')).toBe(
      'C:/data/projects/p2/audit.log'
    )
  })
})

describe('auditLineFromDecision', () => {
  const decision = (overrides: Partial<TraceDecision> = {}): TraceDecision => ({
    id: 'd1',
    runId: 'run-9',
    goalId: 'g1',
    phase: 'executing',
    intent: { summary: 'edit the file' },
    evidence: [
      { kind: 'command', ref: 'npm test', summary: 'ran' },
      { kind: 'output', ref: 'npm test', summary: 'ok', file: 'src/a.ts', hash: 'abc' }
    ],
    decision: 'run_command(npm test)',
    outcome: 'ok',
    at: 5000,
    ...overrides
  })

  it('maps a decision to a line', () => {
    const line = auditLineFromDecision(decision(), { projectId: 'p1', vpsId: 'v1' })
    expect(line.ts).toBe(new Date(5000).toISOString())
    expect(line.runId).toBe('run-9')
    expect(line.goalId).toBe('g1')
    expect(line.command).toBe('npm test')
    expect(line.path).toBe('src/a.ts')
    expect(line.evidenceHash).toBe('abc')
    expect(line.result).toBe('ok')
    expect(line.approval).toBe('not_required')
  })

  it('marks a blocked outcome as blocked approval', () => {
    const line = auditLineFromDecision(decision({ outcome: 'blocked' }), { projectId: 'p1' })
    expect(line.result).toBe('blocked')
    expect(line.approval).toBe('blocked')
  })

  it('treats a failed outcome as failed and omits absent fields', () => {
    const line = auditLineFromDecision(
      decision({ outcome: 'failed', evidence: [], goalId: undefined }),
      { projectId: 'p1' }
    )
    expect(line.result).toBe('failed')
    expect(line.command).toBeUndefined()
    expect(line.path).toBeUndefined()
    expect(line.goalId).toBeUndefined()
  })
})

describe('auditLineFromPreflightOverride (v2.6.3 T3.2.3)', () => {
  it('records an override as approved with the tier, reason and choice', () => {
    const line = auditLineFromPreflightOverride({
      projectId: 'p1',
      vpsId: 'v1',
      runId: 'run-1',
      tool: 'remote_write_file',
      tier: 'block',
      reason: 'Disk 95% full',
      choice: 'proceed',
      at: 5000
    })
    expect(line.ts).toBe(new Date(5000).toISOString())
    expect(line.approval).toBe('approved')
    expect(line.result).toBe('ok')
    expect(line.tool).toBe('remote_write_file')
    expect(line.preflightTier).toBe('block')
    expect(line.preflightReason).toBe('Disk 95% full')
    expect(line.userChoice).toBe('proceed')
  })

  it.each(['cleanup', 'cancel', 'retry'] as const)(
    'records %s as denied/blocked',
    (choice) => {
      const line = auditLineFromPreflightOverride({
        projectId: 'p1',
        runId: 'run-1',
        tool: 'remote_write_file',
        tier: 'block',
        reason: 'Disk full',
        choice
      })
      expect(line.approval).toBe('denied')
      expect(line.result).toBe('blocked')
    }
  )
})

describe('AuditTrail preflight override lines', () => {
  it('writes an override line and still verifies', async () => {
    const trail = new AuditTrail({ file, userId: 'tester' })
    await trail.append(entry())
    await trail.append(
      auditLineFromPreflightOverride({
        projectId: 'p1',
        runId: 'run-1',
        tool: 'remote_write_file',
        tier: 'block',
        reason: 'Disk 95% full',
        choice: 'proceed'
      })
    )

    expect((await trail.verify())).toEqual({ ok: true, lines: 2 })
    const stored = await lines()
    expect(stored[1]).toMatchObject({
      userChoice: 'proceed',
      preflightTier: 'block',
      tool: 'remote_write_file'
    })
  })

  it('detects tampering with the recorded user choice', async () => {
    const trail = new AuditTrail({ file })
    await trail.append(
      auditLineFromPreflightOverride({
        projectId: 'p1',
        runId: 'run-1',
        tool: 'remote_write_file',
        tier: 'block',
        reason: 'Disk 95% full',
        choice: 'proceed'
      })
    )

    const stored = await lines()
    stored[0].userChoice = 'cancel'
    await fs.writeFile(file, `${stored.map((line) => JSON.stringify(line)).join('\n')}\n`, 'utf8')

    const result = await trail.verify()
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('hash mismatch')
  })
})
