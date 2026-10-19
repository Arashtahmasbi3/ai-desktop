/**
 * X8 — a command that runs ON the remote host may reference any absolute path there.
 *
 * Proven bug, verbatim from the user's session log:
 *
 *   remote_shell failed: Blocked: Path "/opt" is outside project root "/opt/sepehr-motor"
 *   remote_shell failed: Blocked: Path "/root/.ssh/" is outside project root "/opt/sepehr-motor"
 *
 * The commands were `df -h /opt` and `ls /root/.ssh`, ordinary inspection run through SSH on the
 * remote host. The guard compared one machine's paths with another machine's project root: the
 * v4.1 bug one layer down — fixed there for `ssh host '…'` payloads, but `remote_shell` is a
 * payload already, so its whole command was still being contained.
 *
 * What changed: containment is a FILE-TOOL boundary. `enforceCommandPaths(..., 'remote-host')`
 * stands down for a READ on the host, while `enforceProjectPath` still judging `remote_read_file`,
 * `remote_write_file`, `remote_list_dir` and `remote_grep` is untouched. A command that is not
 * provably a read still changes the host, so it keeps the containment rule (`echo hi >
 * /etc/os-release` below). The secret-path guard and the deny list still run on every remote
 * command, before anything reaches the host — that is what the negatives below pin.
 *
 * Known limit, stated rather than hidden: `ls -la /root/.ssh` is no longer refused for leaving the
 * project, but the always-on secret-path guard still refuses anything inside a credentials
 * directory, and it cannot tell `ls` from `tar` on the host. Allowing it needs a decision about the
 * secret guard, not about containment; `cat /root/.ssh/id_rsa` must keep failing either way.
 */
import { describe, expect, it } from 'vitest'
import type { VpsExecResult } from '@shared/vps'
import { enforceCommandPaths, enforceProjectPath } from '../../src/core/remote/path-guard'
import { routeToolCall } from '../../src/core/agent/remote-routing'
import { checkDenyList } from '../../src/core/agent/deny-list'
import { findSecretPathsInCommand } from '../../src/shared/secret-paths'
import { executeRemoteFs, type RemoteFsDeps } from '../../src/core/tools/remote-fs-tools'
import { executeRemoteShell, type RemoteShellDeps } from '../../src/core/tools/remote-shell-tool'

const ROOT = '/opt/sepehr-motor'

/** A shell deps double that records the command the host was actually asked to run. */
function shellDeps(projectRoot?: string): RemoteShellDeps & { commands: string[] } {
  const commands: string[] = []
  const deps: RemoteShellDeps & { commands: string[] } = {
    commands,
    connectedServers: () => ['srv-1'],
    exec: async (_serverId, command): Promise<VpsExecResult> => {
      commands.push(command)
      return { ok: true, stdout: 'ok', stderr: '', exitCode: 0 }
    }
  }
  if (projectRoot) deps.projectRoot = projectRoot
  return deps
}

/** Remote file tools, with a project root so containment is actually in play. */
function fsDeps(projectRoot: string): RemoteFsDeps {
  return {
    connectedServers: () => ['srv-1'],
    projectRoot,
    readFile: async (_serverId, path) => `content:${path}`,
    writeFile: async () => undefined,
    listFiles: async () => [],
    exec: async (): Promise<VpsExecResult> => ({ ok: true, stdout: '', stderr: '', exitCode: 0 })
  }
}

const REMOTE = {
  workspaceType: 'remote' as const,
  serverId: 'srv-1',
  remotePath: ROOT,
  connected: true
}

describe('X8 — the positive case: inspection of the host is allowed', () => {
  it('runs `ls /opt` on the host', async () => {
    const deps = shellDeps(ROOT)
    const result = await executeRemoteShell(deps, { server_id: 'srv-1', command: 'ls /opt' })
    expect(result.ok).toBe(true)
    expect(deps.commands).toEqual([`cd '${ROOT}' && ls /opt`])
  })

  it('runs `df -h /opt`, the first command the log lost a turn to', async () => {
    const deps = shellDeps(ROOT)
    const result = await executeRemoteShell(deps, { server_id: 'srv-1', command: 'df -h /opt' })
    expect(result.ok).toBe(true)
    expect(result.content).not.toMatch(/outside project root/)
    expect(deps.commands).toEqual([`cd '${ROOT}' && df -h /opt`])
  })

  it('runs a write-shaped command that names no off-project path', async () => {
    const deps = shellDeps(ROOT)
    const result = await executeRemoteShell(deps, {
      server_id: 'srv-1',
      command: 'systemctl restart nginx'
    })
    expect(result.ok).toBe(true)
    expect(deps.commands).toHaveLength(1)
  })

  it('admits `cat ~/.ssh/config` at the containment layer', () => {
    // Containment is the layer that compared `/opt` and `/root/.ssh` with the project root.
    expect(enforceCommandPaths('cat ~/.ssh/config', ROOT, null, 'remote-host')).toEqual({ ok: true })
  })

  it('redirects a run_command that names a host path instead of refusing it', () => {
    const decision = routeToolCall('run_command', { command: 'df -h /opt' }, REMOTE)
    expect(decision).toMatchObject({ kind: 'redirect', tool: 'remote_shell' })
  })

  it('no longer refuses /root/.ssh for leaving the project — the secret guard is what stops it', async () => {
    const deps = shellDeps(ROOT)
    const result = await executeRemoteShell(deps, {
      server_id: 'srv-1',
      command: 'ls -la /root/.ssh'
    })
    expect(result.ok).toBe(false)
    expect(result.blocked).toBe(true)
    // A different, unchanged rule: credentials directories are never referenced by the agent.
    expect(result.content).toMatch(/credentials directory/i)
    expect(result.content).not.toMatch(/outside project root/)
    expect(deps.commands).toEqual([])
  })
})

describe('X8 — the negatives that still fail', () => {
  it('still refuses `cat /etc/shadow` — by the deny layer, not by containment', async () => {
    // Name the layer that stops it: the always-on system-file rule of the secret-path guard.
    expect(findSecretPathsInCommand('cat /etc/shadow')).not.toEqual([])
    const deps = shellDeps(ROOT)
    const result = await executeRemoteShell(deps, { server_id: 'srv-1', command: 'cat /etc/shadow' })
    expect(result.ok).toBe(false)
    expect(result.blocked).toBe(true)
    expect(result.content).not.toMatch(/outside project root/)
    expect(deps.commands).toEqual([])
  })

  it('still refuses a destructive command through the deny list', async () => {
    expect(checkDenyList('rm -rf /').blocked).toBe(true)
    const deps = shellDeps(ROOT)
    const result = await executeRemoteShell(deps, { server_id: 'srv-1', command: 'rm -rf /' })
    expect(result.ok).toBe(false)
    expect(result.blocked).toBe(true)
    expect(result.content).toMatch(/policy/i)
    expect(deps.commands).toEqual([])
  })

  it('keeps containment for a WRITE to a host path outside the project', async () => {
    const deps = shellDeps(ROOT)
    const result = await executeRemoteShell(deps, {
      server_id: 'srv-1',
      command: 'echo hi > /etc/os-release'
    })
    expect(result.ok).toBe(false)
    expect(result.blocked).toBe(true)
    expect(deps.commands).toEqual([])
  })

  it('still refuses a file-tool read of /root/.ssh/id_rsa in the secret guard', async () => {
    const result = await executeRemoteFs(fsDeps(ROOT), 'remote_read_file', {
      server_id: 'srv-1',
      path: '/root/.ssh/id_rsa'
    })
    expect(result.ok).toBe(false)
    expect(result.blocked).toBe(true)
    expect(result.content).toMatch(/credential/i)
  })

  it('still fails a `..` escape through a file tool', async () => {
    expect(enforceProjectPath(`${ROOT}/../../etc/passwd`, ROOT).ok).toBe(false)
    const result = await executeRemoteFs(fsDeps(ROOT), 'remote_read_file', {
      server_id: 'srv-1',
      path: '../../etc/passwd'
    })
    expect(result.ok).toBe(false)
    expect(result.blocked).toBe(true)
  })

  it('keeps the local rule: the same commands on THIS machine are still refused', () => {
    expect(enforceCommandPaths('ls /opt', ROOT).ok).toBe(false)
    expect(enforceCommandPaths('cat /etc/shadow', ROOT).ok).toBe(false)
    expect(enforceCommandPaths('cd .. && cat etc/shadow', ROOT).ok).toBe(false)
  })
})
