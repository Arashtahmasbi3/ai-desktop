import { describe, it, expect } from 'vitest'
import type { VpsExecResult } from '@shared/vps'
import {
  enforceProjectPath,
  enforceCommandPaths,
  extractAbsolutePaths
} from '@core/remote/path-guard'
import { routeToolCall } from '@core/agent/remote-routing'
import { executeRemoteFs, type RemoteFsDeps } from '@core/tools/remote-fs-tools'
import { executeRemoteShell, type RemoteShellDeps } from '@core/tools/remote-shell-tool'

/**
 * P0-2: Remote Path Enforcement. A remote project must never be able to read or
 * write outside its own root, whether the path arrives as a dedicated file tool
 * argument, a shell command, or a stray local tool call that gets rerouted.
 */
const ROOT = '/opt/demo-project'

describe('enforceProjectPath', () => {
  it('allows a relative path inside the root', () => {
    const result = enforceProjectPath('src/index.ts', ROOT)
    expect(result.ok).toBe(true)
    expect(result.resolvedPath).toBe('/opt/demo-project/src/index.ts')
  })

  it('allows an absolute path inside the root', () => {
    const result = enforceProjectPath('/opt/demo-project/src/app.ts', ROOT)
    expect(result.ok).toBe(true)
    expect(result.resolvedPath).toBe('/opt/demo-project/src/app.ts')
  })

  it('allows the root itself', () => {
    expect(enforceProjectPath(ROOT, ROOT).ok).toBe(true)
    expect(enforceProjectPath('.', ROOT).resolvedPath).toBe(ROOT)
  })

  it('rejects an absolute path outside the root', () => {
    const result = enforceProjectPath('/etc/nginx/nginx.conf', ROOT)
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/outside project root/)
  })

  it('rejects a sibling directory sharing the root prefix', () => {
    expect(enforceProjectPath('/opt/demo-project-evil/x', ROOT).ok).toBe(false)
  })

  it('rejects path traversal', () => {
    expect(enforceProjectPath('../../etc/passwd', ROOT).ok).toBe(false)
    expect(enforceProjectPath('src/../../etc/passwd', ROOT).ok).toBe(false)
    expect(enforceProjectPath('/opt/demo-project/../secrets', ROOT).ok).toBe(false)
  })

  it('rejects control characters', () => {
    const result = enforceProjectPath('/opt/demo-project/file\x00.txt', ROOT)
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/control characters/)
  })

  it('rejects empty or non-string input', () => {
    expect(enforceProjectPath('', ROOT).ok).toBe(false)
    expect(enforceProjectPath(undefined as unknown as string, ROOT).ok).toBe(false)
  })

  it('tolerates a trailing slash on the root', () => {
    expect(enforceProjectPath('src/a.ts', '/opt/demo-project/').resolvedPath).toBe(
      '/opt/demo-project/src/a.ts'
    )
  })
})

describe('extractAbsolutePaths / enforceCommandPaths', () => {
  it('extracts absolute paths but ignores URLs and relative paths', () => {
    const paths = extractAbsolutePaths('curl https://api.example.com/v1 && cat src/a.ts /etc/hosts')
    expect(paths).toContain('/etc/hosts')
    expect(paths.some((p) => p.includes('api.example.com'))).toBe(false)
    expect(paths.some((p) => p === 'src/a.ts')).toBe(false)
  })

  it('allows a command that only touches the project', () => {
    expect(enforceCommandPaths('cd /opt/demo-project && npm test', ROOT).ok).toBe(true)
  })

  it('allows benign device redirections', () => {
    expect(enforceCommandPaths('npm test > /dev/null 2>&1', ROOT).ok).toBe(true)
  })

  it('rejects a command that reads outside the project', () => {
    const result = enforceCommandPaths('cat /etc/passwd', ROOT)
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/outside project root/)
  })

  it('rejects a command that writes outside the project', () => {
    expect(enforceCommandPaths('echo x > /root/.ssh/authorized_keys', ROOT).ok).toBe(false)
  })
})

describe('routeToolCall containment', () => {
  const context = {
    workspaceType: 'remote' as const,
    serverId: 'srv-1',
    remotePath: ROOT,
    connected: true
  }

  it('redirects an in-project read and rebases a relative path', () => {
    const decision = routeToolCall('read_file', { path: 'src/index.ts' }, context)
    expect(decision).toMatchObject({
      kind: 'redirect',
      tool: 'remote_read_file',
      args: { path: '/opt/demo-project/src/index.ts' }
    })
  })

  it('refuses a local read of a path outside the project', () => {
    const decision = routeToolCall('read_file', { path: '/etc/passwd' }, context)
    expect(decision.kind).toBe('error')
  })

  it('refuses a local write of a traversal path', () => {
    const decision = routeToolCall('write_file', { path: '../secrets', content: 'x' }, context)
    expect(decision.kind).toBe('error')
  })

  it('refuses a run_command that references an outside path', () => {
    const decision = routeToolCall('run_command', { command: 'cat /etc/passwd' }, context)
    expect(decision.kind).toBe('error')
  })

  it('still redirects a run_command that stays inside the project', () => {
    const decision = routeToolCall('run_command', { command: 'ls /opt/demo-project' }, context)
    expect(decision).toMatchObject({ kind: 'redirect', tool: 'remote_shell' })
  })
})

describe('executeRemoteFs containment', () => {
  function deps(projectRoot?: string): RemoteFsDeps & { writes: string[] } {
    const writes: string[] = []
    const result: RemoteFsDeps & { writes: string[] } = {
      writes,
      connectedServers: () => ['srv-1'],
      readFile: async (_serverId, path) => {
        if (path === '/etc/passwd') throw new Error('should not be reached')
        return `content:${path}`
      },
      writeFile: async (_serverId, path) => {
        writes.push(path)
      },
      listFiles: async (_serverId, path) => [{ name: path, path, type: 'file' }],
      exec: async (): Promise<VpsExecResult> => ({ ok: true, stdout: 'no', stderr: '', exitCode: 0 })
    }
    if (projectRoot) result.projectRoot = projectRoot
    return result
  }

  it('blocks reading outside the root before touching the VPS', async () => {
    const d = deps(ROOT)
    const result = await executeRemoteFs(d, 'remote_read_file', {
      server_id: 'srv-1',
      path: '/etc/passwd'
    })
    expect(result.ok).toBe(false)
    expect(result.blocked).toBe(true)
  })

  it('blocks writing outside the root', async () => {
    const d = deps(ROOT)
    const result = await executeRemoteFs(d, 'remote_write_file', {
      server_id: 'srv-1',
      path: '/root/.ssh/authorized_keys',
      content: 'evil'
    })
    expect(result.ok).toBe(false)
    expect(d.writes).toEqual([])
  })

  it('allows a read inside the root', async () => {
    const result = await executeRemoteFs(deps(ROOT), 'remote_read_file', {
      server_id: 'srv-1',
      path: `${ROOT}/src/index.ts`
    })
    expect(result.ok).toBe(true)
  })

  it('skips enforcement when no project root is known', async () => {
    const result = await executeRemoteFs(deps(), 'remote_read_file', {
      server_id: 'srv-1',
      path: '/etc/hosts'
    })
    expect(result.ok).toBe(true)
  })
})

describe('executeRemoteShell containment', () => {
  function deps(projectRoot?: string): RemoteShellDeps & { ran: string[] } {
    const ran: string[] = []
    const result: RemoteShellDeps & { ran: string[] } = {
      ran,
      connectedServers: () => ['srv-1'],
      exec: async (_serverId, command): Promise<VpsExecResult> => {
        ran.push(command)
        return { ok: true, stdout: 'ok', stderr: '', exitCode: 0 }
      }
    }
    if (projectRoot) result.projectRoot = projectRoot
    return result
  }

  it('refuses a command referencing a path outside the project', async () => {
    const d = deps(ROOT)
    const result = await executeRemoteShell(d, { server_id: 'srv-1', command: 'cat /etc/passwd' })
    expect(result.ok).toBe(false)
    expect(result.blocked).toBe(true)
    expect(d.ran).toEqual([])
  })

  it('runs a command that stays inside the project', async () => {
    const d = deps(ROOT)
    const result = await executeRemoteShell(d, {
      server_id: 'srv-1',
      command: 'cd /opt/demo-project && git status'
    })
    expect(result.ok).toBe(true)
    expect(d.ran).toHaveLength(1)
  })

  it('skips enforcement when no project root is known', async () => {
    const d = deps()
    const result = await executeRemoteShell(d, { server_id: 'srv-1', command: 'cat /etc/passwd' })
    expect(result.ok).toBe(true)
  })
})
