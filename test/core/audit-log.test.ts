import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import { AuditLog } from '../../src/core/agent/audit-log'

let dir: string
let file: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'audit-'))
  file = join(dir, 'ssh-audit.json')
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('audit log', () => {
  it('records entries and persists them as JSON', async () => {
    const log = new AuditLog({ file })
    await log.record({ type: 'connect', ok: true, serverId: 'srv-1' })
    await log.record({ type: 'exec', ok: true, serverId: 'srv-1', command: 'ls' })

    const onDisk = JSON.parse(await fs.readFile(file, 'utf8')) as unknown[]
    expect(onDisk).toHaveLength(2)
    expect(log.entries().map((entry) => entry.type)).toEqual(['connect', 'exec'])
    expect(log.byServer('srv-1')).toHaveLength(2)
  })

  it('reloads existing entries', async () => {
    await new AuditLog({ file }).record({ type: 'blocked', ok: false, command: 'rm -rf /' })
    const reloaded = new AuditLog({ file })
    await reloaded.load()
    expect(reloaded.entries()).toHaveLength(1)
    expect(reloaded.entries()[0].type).toBe('blocked')
  })

  it('keeps only the most recent maxEntries', async () => {
    const log = new AuditLog({ file, maxEntries: 2 })
    for (const command of ['a', 'b', 'c']) {
      await log.record({ type: 'exec', ok: true, command })
    }
    expect(log.entries().map((entry) => entry.command)).toEqual(['b', 'c'])
  })

  it('does not throw when the log file cannot be written', async () => {
    const log = new AuditLog({ file: join(dir, 'missing-dir', 'nested', 'audit.json') })
    await expect(log.record({ type: 'exec', ok: true })).resolves.toMatchObject({ type: 'exec' })
  })
})
