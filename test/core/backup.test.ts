import { describe, it, expect } from 'vitest'
import type { RemoteFileEntry, VpsExecResult } from '@shared/vps'
import type { AuditEntry } from '@core/agent/audit-log'
import type { RemoteFsDeps } from '@core/tools/remote-fs-tools'
import { executeRemoteFs } from '@core/tools/remote-fs-tools'
import {
  BACKUP_SUFFIX,
  backupPathFor,
  isBackupPath,
  parseBackupPath,
  restoreCommandFor
} from '@core/remote/backup'

interface FakeDeps extends RemoteFsDeps {
  files: Map<string, string>
  execCalls: string[]
  auditEntries: Array<Omit<AuditEntry, 'at'>>
  failCopy: boolean
}

function fakeDeps(files: Record<string, string> = {}, failCopy = false): FakeDeps {
  const store = new Map(Object.entries(files))
  const execCalls: string[] = []
  const auditEntries: Array<Omit<AuditEntry, 'at'>> = []
  return {
    files: store,
    execCalls,
    auditEntries,
    failCopy,
    connectedServers: () => ['srv-1'],
    readFile: async (_serverId, path) => {
      const content = store.get(path)
      if (content === undefined) throw new Error('ENOENT')
      return content
    },
    writeFile: async (_serverId, path, content) => {
      store.set(path, content)
    },
    listFiles: async (_serverId, _path): Promise<RemoteFileEntry[]> => [],
    exec: async (_serverId, command): Promise<VpsExecResult> => {
      execCalls.push(command)
      if (command.startsWith('cp ')) {
        if (failCopy) return { ok: false, stdout: '', stderr: 'no space', exitCode: 1 }
        const [from, to] = [...command.matchAll(/'((?:[^']|'\\'')*)'/g)].map((m) =>
          m[1].replace(/'\\''/g, "'")
        )
        const content = store.get(from)
        if (content !== undefined) store.set(to, content)
      }
      return { ok: true, stdout: '', stderr: '', exitCode: 0 }
    },
    audit: async (entry) => {
      auditEntries.push(entry)
    }
  }
}

describe('backup path helpers', () => {
  it('builds and parses a backup path', () => {
    const backup = backupPathFor('/etc/app.conf', 1700000000000)
    expect(backup).toBe(`/etc/app.conf${BACKUP_SUFFIX}1700000000000`)
    expect(parseBackupPath(backup)).toEqual({ original: '/etc/app.conf', at: 1700000000000 })
  })

  it('does not treat normal paths as backups', () => {
    expect(isBackupPath('/etc/app.conf')).toBe(false)
    expect(isBackupPath('/etc/app.conf.backup-notanumber')).toBe(false)
    expect(parseBackupPath('backup-1')).toBeNull()
  })

  it('builds a restore command that copies the backup back over the original', () => {
    const command = restoreCommandFor('/etc/app.conf.backup-1700000000000', (v) => `'${v}'`)
    expect(command).toBe("cp -p -- '/etc/app.conf.backup-1700000000000' '/etc/app.conf'")
    expect(restoreCommandFor('/etc/app.conf', (v) => `'${v}'`)).toBeNull()
  })
})

describe('remote_write_file backups (B.1)', () => {
  it('does not back up when the file is new', async () => {
    const deps = fakeDeps()
    const result = await executeRemoteFs(deps, 'remote_write_file', {
      server_id: 'srv-1',
      path: '/tmp/new.txt',
      content: 'hello'
    })

    expect(result.ok).toBe(true)
    expect(deps.execCalls).toHaveLength(0)
    expect(deps.auditEntries.some((e) => e.type === 'backup_created')).toBe(false)
  })

  it('copies an existing file to a timestamped backup before overwriting', async () => {
    const deps = fakeDeps({ '/etc/app.conf': 'old' })
    deps.now = () => 42
    const result = await executeRemoteFs(deps, 'remote_write_file', {
      server_id: 'srv-1',
      path: '/etc/app.conf',
      content: 'new'
    })

    expect(result.ok).toBe(true)
    expect(deps.execCalls).toEqual([`cp -p -- '/etc/app.conf' '/etc/app.conf.backup-42'`])
    expect(deps.files.get('/etc/app.conf.backup-42')).toBe('old')
    expect(deps.files.get('/etc/app.conf')).toBe('new')

    const audit = deps.auditEntries.find((e) => e.type === 'backup_created')
    expect(audit).toMatchObject({ ok: true, detail: '/etc/app.conf.backup-42' })
  })

  it('aborts the write when the backup copy fails', async () => {
    const deps = fakeDeps({ '/etc/app.conf': 'old' }, true)
    const result = await executeRemoteFs(deps, 'remote_write_file', {
      server_id: 'srv-1',
      path: '/etc/app.conf',
      content: 'new'
    })

    expect(result.ok).toBe(false)
    expect(result.content).toContain('Could not back up')
    expect(deps.files.get('/etc/app.conf')).toBe('old')
    expect(deps.auditEntries.some((e) => e.type === 'backup_created')).toBe(false)
  })
})
