/**
 * Sprint v2.3 security scenarios for the cross-VPS `migrate_project` tool.
 * These assert that hostile paths / server ids can never reach the shell: the
 * SSH layer is mocked, so a passing test proves nothing was executed.
 */
import { describe, it, expect } from 'vitest'
import type { VpsExecResult } from '@shared/vps'
import {
  executeMigrateProject,
  type MigrateProjectDeps,
  type ServerConnection
} from '../../src/core/tools/migrate-project-tool'
import type { AuditEntry } from '../../src/core/agent/audit-log'

const SAFE_TARGET: ServerConnection = { host: '10.0.0.9', port: 22, username: 'deploy' }

interface FakeSsh extends MigrateProjectDeps {
  execCalls: Array<{ serverId: string; command: string }>
  audits: Array<Omit<AuditEntry, 'at'>>
}

function fakeSsh(
  options: {
    connected?: string[]
    servers?: Record<string, ServerConnection>
    result?: Partial<VpsExecResult>
  } = {}
): FakeSsh {
  const connected = options.connected ?? ['srv-1']
  const servers = options.servers ?? { 'srv-2': SAFE_TARGET }
  const execCalls: Array<{ serverId: string; command: string }> = []
  const audits: Array<Omit<AuditEntry, 'at'>> = []
  return {
    execCalls,
    audits,
    connectedServers: () => connected,
    resolveServer: async (id) => servers[id],
    exec: async (serverId, command): Promise<VpsExecResult> => {
      execCalls.push({ serverId, command })
      return { ok: true, stdout: 'ok', stderr: '', exitCode: 0, ...options.result }
    },
    audit: async (entry) => {
      audits.push(entry)
    }
  }
}

function args(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    source_vps_id: 'srv-1',
    source_path: '/var/www/app',
    target_vps_id: 'srv-2',
    target_path: '/srv/app',
    ...overrides
  }
}

describe('migrate_project: path injection', () => {
  it.each(['/var/www/app\u0000', '/var/www/app\nrm -rf /', '/var/www/app\rx', '/var/www\tapp'])(
    'rejects control characters in source_path: %j',
    async (sourcePath) => {
      const deps = fakeSsh()
      const result = await executeMigrateProject(deps, args({ source_path: sourcePath }))
      expect(result.ok).toBe(false)
      expect(result.content).toMatch(/control characters/)
      expect(deps.execCalls).toHaveLength(0)
    }
  )

  it.each(['/var/www/app; rm -rf /', '/var/www/app | tee /tmp/x', '/var/www/app && reboot'])(
    'rejects shell metacharacters in source_path: %j',
    async (sourcePath) => {
      const deps = fakeSsh()
      const result = await executeMigrateProject(deps, args({ source_path: sourcePath }))
      expect(result.ok).toBe(false)
      expect(result.content).toMatch(/shell metacharacters/)
      expect(deps.execCalls).toHaveLength(0)
    }
  )

  it('rejects a backtick in target_path', async () => {
    const deps = fakeSsh()
    const result = await executeMigrateProject(deps, args({ target_path: '/srv/`whoami`' }))
    expect(result.ok).toBe(false)
    expect(result.content).toMatch(/metacharacters/)
    expect(deps.execCalls).toHaveLength(0)
  })

  it('rejects a $() command substitution in target_path', async () => {
    const deps = fakeSsh()
    const result = await executeMigrateProject(deps, args({ target_path: '/srv/$(reboot)' }))
    expect(result.ok).toBe(false)
    expect(deps.execCalls).toHaveLength(0)
  })
})

describe('migrate_project: sensitive system paths', () => {
  it.each(['/etc', '/etc/nginx', '/var/log', '/proc', '/sys'])(
    'blocks sensitive source_path: %s',
    async (sourcePath) => {
      const deps = fakeSsh()
      const result = await executeMigrateProject(deps, args({ source_path: sourcePath }))
      expect(result.ok).toBe(false)
      expect(result.blocked).toBe(true)
      expect(result.content).toMatch(/sensitive system path/)
      expect(deps.execCalls).toHaveLength(0)
    }
  )

  it.each(['/dev', '/dev/sda', '/proc/1'])(
    'blocks sensitive target_path: %s',
    async (targetPath) => {
      const deps = fakeSsh()
      const result = await executeMigrateProject(deps, args({ target_path: targetPath }))
      expect(result.ok).toBe(false)
      expect(result.blocked).toBe(true)
      expect(deps.execCalls).toHaveLength(0)
    }
  )

  it('does not flag a normal project path under /var/www', async () => {
    const deps = fakeSsh()
    const result = await executeMigrateProject(deps, args())
    expect(result.ok).toBe(true)
    // One dry-run plus the real transfer.
    expect(deps.execCalls).toHaveLength(2)
    expect(deps.execCalls[0]!.command).toContain('--dry-run')
    expect(deps.execCalls[1]!.command).not.toContain('--dry-run')
  })
})

describe('migrate_project: server validation', () => {
  it('fails before exec when the source server is not connected', async () => {
    const deps = fakeSsh({ connected: ['srv-9'] })
    const result = await executeMigrateProject(deps, args())
    expect(result.ok).toBe(false)
    expect(result.content).toMatch(/not connected/i)
    expect(deps.execCalls).toHaveLength(0)
  })

  it('fails on an unknown target server without leaking the saved-server list', async () => {
    const deps = fakeSsh({
      servers: { 'srv-2': SAFE_TARGET },
      connected: ['srv-1', 'srv-2', 'srv-secret']
    })
    const result = await executeMigrateProject(deps, args({ target_vps_id: 'srv-ghost' }))
    expect(result.ok).toBe(false)
    expect(result.content).toMatch(/Unknown target server/)
    // Must not enumerate other saved servers.
    expect(result.content).not.toContain('srv-1')
    expect(result.content).not.toContain('srv-2')
    expect(result.content).not.toContain('srv-secret')
    expect(deps.execCalls).toHaveLength(0)
  })

  it('rejects a target username containing a dangerous character', async () => {
    const deps = fakeSsh({
      servers: { 'srv-2': { host: '10.0.0.9', port: 22, username: 'deploy;rm -rf /' } }
    })
    const result = await executeMigrateProject(deps, args())
    expect(result.ok).toBe(false)
    expect(result.content).toMatch(/unsafe username/)
    expect(deps.execCalls).toHaveLength(0)
  })

  it('rejects a target username with a backtick', async () => {
    const deps = fakeSsh({
      servers: { 'srv-2': { host: '10.0.0.9', port: 22, username: 'de`whoami`' } }
    })
    const result = await executeMigrateProject(deps, args())
    expect(result.ok).toBe(false)
    expect(deps.execCalls).toHaveLength(0)
  })
})
