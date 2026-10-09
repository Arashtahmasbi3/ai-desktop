import { describe, it, expect } from 'vitest'
import type { AgentAction } from '@shared/agent'
import type { RemoteFileEntry, VpsExecResult } from '@shared/vps'
import {
  REMOTE_FS_TOOLS,
  executeRemoteFs,
  type RemoteFsDeps
} from '../../src/core/tools/remote-fs-tools'
import { RemoteFsToolExecutor } from '../../src/core/tools/remote-fs-executor'
import type { AuditEntry } from '../../src/core/agent/audit-log'

interface FakeFs extends RemoteFsDeps {
  files: Map<string, string>
  dirs: Map<string, RemoteFileEntry[]>
  execCalls: string[]
  auditEntries: Array<Omit<AuditEntry, 'at'>>
}

function fakeFs(files: Record<string, string> = {}, connected = ['srv-1']): FakeFs {
  const store = new Map(Object.entries(files))
  const execCalls: string[] = []
  const auditEntries: Array<Omit<AuditEntry, 'at'>> = []
  return {
    files: store,
    dirs: new Map(),
    execCalls,
    auditEntries,
    connectedServers: () => connected,
    readFile: async (_serverId, path) => {
      const content = store.get(path)
      if (content === undefined) throw new Error('ENOENT')
      return content
    },
    writeFile: async (_serverId, path, content) => {
      store.set(path, content)
    },
    listFiles: async (_serverId, path) => {
      return [
        { name: 'index.ts', path: `${path}/index.ts`, type: 'file', size: 10 },
        { name: 'src', path: `${path}/src`, type: 'dir' }
      ]
    },
    exec: async (_serverId, command): Promise<VpsExecResult> => {
      execCalls.push(command)
      if (command.startsWith('test -e')) {
        const isFile = command.includes("'/etc/hosts'")
        return { ok: true, stdout: isFile ? 'yes\n' : 'no\n', stderr: '', exitCode: 0 }
      }
      return { ok: true, stdout: 'match:1:line', stderr: '', exitCode: 0 }
    },
    audit: async (entry) => {
      auditEntries.push(entry)
    }
  }
}

function action(name: string, args: Record<string, unknown>, valid = true): AgentAction {
  return {
    id: 'a1',
    name,
    arguments: args,
    rawArguments: JSON.stringify(args),
    valid,
    signature: `${name}:test`
  }
}

describe('REMOTE_FS_TOOLS', () => {
  it('exposes the six Codex-style remote fs tools', () => {
    expect(REMOTE_FS_TOOLS.map((tool) => tool.name).sort()).toEqual([
      'remote_exists',
      'remote_git_status',
      'remote_grep',
      'remote_list_dir',
      'remote_read_file',
      'remote_write_file'
    ])
  })
})

describe('executeRemoteFs', () => {
  it('reads a file and audits it', async () => {
    const deps = fakeFs({ '/app/readme.md': 'hello' })
    const result = await executeRemoteFs(deps, 'remote_read_file', {
      server_id: 'srv-1',
      path: '/app/readme.md'
    })
    expect(result.ok).toBe(true)
    expect(result.content).toBe('hello')
    expect(deps.auditEntries[0]?.command).toContain('fs:read /app/readme.md')
  })

  it('writes a file and audits it', async () => {
    const deps = fakeFs()
    const result = await executeRemoteFs(deps, 'remote_write_file', {
      server_id: 'srv-1',
      path: '/app/main.ts',
      content: 'export {}'
    })
    expect(result.ok).toBe(true)
    expect(deps.files.get('/app/main.ts')).toBe('export {}')
    expect(deps.auditEntries[0]?.command).toBe('fs:write /app/main.ts')
  })

  it('lists a directory', async () => {
    const deps = fakeFs()
    const result = await executeRemoteFs(deps, 'remote_list_dir', {
      server_id: 'srv-1',
      path: '/app'
    })
    expect(result.content).toContain('file  index.ts 10b')
    expect(result.content).toContain('dir   src')
  })

  it('reports existence via shell', async () => {
    const deps = fakeFs()
    const found = await executeRemoteFs(deps, 'remote_exists', {
      server_id: 'srv-1',
      path: '/etc/hosts'
    })
    expect(found.content).toBe('exists')
    expect(deps.execCalls[0]).toContain("test -e '/etc/hosts'")
  })

  it('greps with a shell-quoted pattern and caps output', async () => {
    const deps = fakeFs()
    const result = await executeRemoteFs(deps, 'remote_grep', {
      server_id: 'srv-1',
      pattern: 'TODO|FIXME',
      path: '/app'
    })
    expect(deps.execCalls[0]).toContain("grep -rnE -- 'TODO|FIXME' '/app'")
    expect(deps.execCalls[0]).toContain('head -n 200')
    expect(result.ok).toBe(true)
  })

  it('refuses a path whose shell command trips the deny list', async () => {
    const deps = fakeFs()
    const result = await executeRemoteFs(deps, 'remote_git_status', {
      server_id: 'srv-1',
      path: '/mnt/mkfs.ext4'
    })
    expect(result.ok).toBe(false)
    expect(result.blocked).toBe(true)
    expect(deps.execCalls).toHaveLength(0)
  })

  it('refuses an unknown server and never runs the command', async () => {
    const deps = fakeFs()
    const result = await executeRemoteFs(deps, 'remote_exists', {
      server_id: 'srv-9',
      path: '/etc/hosts'
    })
    expect(result.ok).toBe(false)
    expect(deps.execCalls).toHaveLength(0)
  })

  it('rejects malformed paths', async () => {
    const deps = fakeFs()
    const result = await executeRemoteFs(deps, 'remote_read_file', {
      server_id: 'srv-1',
      path: 'bad\u0000path'
    })
    expect(result.ok).toBe(false)
  })
})

describe('RemoteFsToolExecutor', () => {
  it('pins the server so the model cannot switch hosts', async () => {
    const deps = fakeFs({ '/x': 'content' }, ['srv-1', 'srv-2'])
    const executor = new RemoteFsToolExecutor(deps, 'srv-1')
    const result = await executor.execute(
      action('remote_read_file', { server_id: 'srv-2', path: '/x' })
    )
    expect(result.ok).toBe(true)
    expect(result.output).toBe('content')
  })

  it('reports an unknown tool without a crash', async () => {
    const executor = new RemoteFsToolExecutor(fakeFs(), 'srv-1')
    const result = await executor.execute(action('remote_rm', {}))
    expect(result.ok).toBe(false)
    expect(result.code).toBe('unknown_tool')
  })
})
