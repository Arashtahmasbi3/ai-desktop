/**
 * S1 — containment belongs to the file tools, not to a remote shell.
 *
 * Reported by the user, verbatim from the session:
 *
 *   Blocked: Path "/opt/zoonestore/apps" is outside project root "/opt/sepehr-motor"
 *
 * while reading a directory on a server the user owns as root. The old rule exempted a remote
 * command from containment **only when it was provably read-only**, so the exemption existed and
 * was unreachable in practice: every real diagnostic command carries a redirect, a pipe or a
 * loop.
 *
 * S1.1 removes containment from `remote_shell` for `CommandHost = 'remote-host'` outright. The
 * project root is a write-scope for tools that write on the agent's behalf, not a read-scope for
 * a shell on a host the user is root on. What still governs that command is the deny list, the
 * secret-path guard, the host policy, the approval gate and the audit.
 *
 * S1.2 keeps containment exactly where it belongs: the file tools.
 * S1.3 keeps the write protection without the wall: a write-shaped command whose path leaves the
 * project root is an approval, not a silent block, and it runs when the user approves it.
 * S1.4 pins all six real commands from the user's session, plus the same commands on THIS
 * machine keeping the old rule.
 */
import { describe, expect, it } from 'vitest'
import type { AgentAction } from '@shared/agent'
import type { VpsExecResult } from '@shared/vps'
import {
  enforceCommandPaths,
  enforceProjectPath,
  escapedWritePaths
} from '../../src/core/remote/path-guard'
import { checkDenyList } from '../../src/core/agent/deny-list'
import { findSecretPathsInCommand } from '../../src/shared/secret-paths'
import { executeRemoteFs, type RemoteFsDeps } from '../../src/core/tools/remote-fs-tools'
import {
  executeRemoteShell,
  type RemoteShellDeps
} from '../../src/core/tools/remote-shell-tool'
import { RemoteShellToolExecutor } from '../../src/core/tools/remote-shell-executor'
import { createApprovalGate } from '../../src/main/approval-gate'

const ROOT = '/opt/sepehr-motor'
const SERVER = 'srv-1'

/**
 * The six real commands from the user's session. Every one of them is an ordinary diagnostic:
 * a redirect, a pipe, a loop, `find` and `du`. They are the acceptance criterion for S1.1/S1.4.
 */
const FIXTURES: ReadonlyArray<{ label: string; command: string }> = [
  {
    label: 'find with a stderr redirect and a pipe',
    command: 'find / -maxdepth 4 -name "golden*" -not -path "*/node_modules/*" 2>/dev/null | head -40'
  },
  { label: 'ls piped into head', command: 'ls /opt/zoonestore | head -40' },
  { label: 'cat with a glob and a stderr redirect', command: 'cat /etc/nginx/sites-enabled/* 2>/dev/null | head -60' },
  {
    label: 'du with two absolute paths and a stderr redirect',
    command: 'du -sh /opt/zoonestore/apps /opt/zoonestore/backups 2>/dev/null'
  },
  {
    label: 'a for loop that cats three site configs',
    command:
      'for f in goldenmode2.com zoonestore spmotor.ir; do echo "=== $f ==="; ' +
      'cat /etc/nginx/sites-enabled/$f 2>/dev/null | head -60; done'
  },
  {
    label: 'docker ps with a format string, a redirect and a pipe',
    command:
      "docker ps --format '{{.Names}}\\t{{.Image}}\\t{{.Ports}}' 2>/dev/null | head -30"
  }
]

/**
 * Locally the guard only sees a `/` that starts a token. The `find` fixture's only absolute
 * spellings are a bare `/` and a glob-glued node_modules path, and the `docker ps` fixture names
 * no path at all — so those two are admitted locally by the *old* rule too, which is exactly what
 * this suite preserves. Everything else names a token-leading path.
 */
const LOCAL_REFUSED = FIXTURES.filter(
  (fixture) =>
    fixture.label !== 'docker ps with a format string, a redirect and a pipe' &&
    !fixture.label.startsWith('find with')
)

/** A shell double that records the exact command the host was asked to run. */
function shellDeps(projectRoot?: string): RemoteShellDeps & { commands: string[] } {
  const commands: string[] = []
  const deps: RemoteShellDeps & { commands: string[] } = {
    commands,
    connectedServers: () => [SERVER],
    exec: async (_serverId, command): Promise<VpsExecResult> => {
      commands.push(command)
      return { ok: true, stdout: 'ok', stderr: '', exitCode: 0 }
    }
  }
  if (projectRoot) deps.projectRoot = projectRoot
  return deps
}

/** Remote file tools with a project root, so containment is actually in play. */
function fsDeps(projectRoot?: string): RemoteFsDeps & { reads: string[]; writes: string[] } {
  const reads: string[] = []
  const writes: string[] = []
  const deps: RemoteFsDeps & { reads: string[]; writes: string[] } = {
    reads,
    writes,
    connectedServers: () => [SERVER],
    readFile: async (_serverId, path) => {
      reads.push(path)
      return `content:${path}`
    },
    writeFile: async (_serverId, path) => {
      writes.push(path)
    },
    listFiles: async () => [],
    exec: async (): Promise<VpsExecResult> => ({ ok: true, stdout: '', stderr: '', exitCode: 0 })
  }
  if (projectRoot) deps.projectRoot = projectRoot
  return deps
}

function action(command: string): AgentAction {
  return {
    id: 'call-s1',
    name: 'remote_shell',
    arguments: { server_id: SERVER, command },
    rawArguments: JSON.stringify({ server_id: SERVER, command }),
    valid: true,
    signature: `remote_shell:${command}`
  }
}

describe('S1.1 — a remote shell command is not contained by the project root', () => {
  it.each(FIXTURES.map((fixture) => [fixture.label, fixture.command] as const))(
    'admits the real diagnostic at the guard: %s',
    (_label, command) => {
      expect(enforceCommandPaths(command, ROOT, null, 'remote-host')).toEqual({ ok: true })
    }
  )

  it.each(FIXTURES.map((fixture) => [fixture.label, fixture.command] as const))(
    'runs the real diagnostic on the host: %s',
    async (_label, command) => {
      const deps = shellDeps(ROOT)
      const result = await executeRemoteShell(deps, { server_id: SERVER, command })
      expect(result.ok).toBe(true)
      expect(result.blocked).toBeUndefined()
      expect(result.content).not.toMatch(/outside project root/)
      expect(deps.commands).toEqual([`cd '${ROOT}' && ${command}`])
    }
  )

  it('runs a read-shaped command that walks up from the project directory', async () => {
    // `cd ..` on the host is the host's own filesystem; the project root is its cwd, not a box.
    const deps = shellDeps(ROOT)
    const result = await executeRemoteShell(deps, {
      server_id: SERVER,
      command: 'cd .. && ls /opt'
    })
    expect(result.ok).toBe(true)
    expect(deps.commands).toHaveLength(1)
  })

  it('runs a write-shaped command that names no off-project path', async () => {
    // The command is still classified as a write; approval is the gate's job, not containment's.
    const deps = shellDeps(ROOT)
    const result = await executeRemoteShell(deps, {
      server_id: SERVER,
      command: 'systemctl restart nginx'
    })
    expect(result.ok).toBe(true)
    expect(deps.commands).toHaveLength(1)
  })
})

describe('S1.2 — the file tools stay inside the project root', () => {
  it('refuses an off-root read with the containment rule', async () => {
    const deps = fsDeps(ROOT)
    const result = await executeRemoteFs(deps, 'remote_read_file', {
      server_id: SERVER,
      path: '/opt/zoonestore/package.json'
    })
    expect(result.ok).toBe(false)
    expect(result.blocked).toBe(true)
    expect(result.content).toMatch(/containment/)
    expect(deps.reads).toEqual([])
  })

  it('refuses the .env the user asked about (the secret guard fires first)', async () => {
    const deps = fsDeps(ROOT)
    const result = await executeRemoteFs(deps, 'remote_read_file', {
      server_id: SERVER,
      path: '/opt/zoonestore/.env'
    })
    expect(result.ok).toBe(false)
    expect(result.blocked).toBe(true)
    expect(deps.reads).toEqual([])
  })

  it('refuses a .. escape through a file tool', async () => {
    const deps = fsDeps(ROOT)
    const result = await executeRemoteFs(deps, 'remote_read_file', {
      server_id: SERVER,
      path: '../../etc/passwd'
    })
    expect(result.ok).toBe(false)
    expect(result.blocked).toBe(true)
    expect(deps.reads).toEqual([])
  })

  it('refuses an off-root list_dir', async () => {
    const deps = fsDeps(ROOT)
    const result = await executeRemoteFs(deps, 'remote_list_dir', {
      server_id: SERVER,
      path: '/opt/zoonestore'
    })
    expect(result.ok).toBe(false)
    expect(result.blocked).toBe(true)
    expect(result.content).toMatch(/containment/)
  })

  it('refuses an off-root write', async () => {
    const deps = fsDeps(ROOT)
    const result = await executeRemoteFs(deps, 'remote_write_file', {
      server_id: SERVER,
      path: '/opt/zoonestore/apps/.env',
      content: 'x'
    })
    expect(result.ok).toBe(false)
    expect(deps.writes).toEqual([])
  })

  it('still reads an in-root path', async () => {
    const deps = fsDeps(ROOT)
    const result = await executeRemoteFs(deps, 'remote_read_file', {
      server_id: SERVER,
      path: `${ROOT}/package.json`
    })
    expect(result.ok).toBe(true)
    expect(deps.reads).toEqual([`${ROOT}/package.json`])
  })
})

describe('S1.3 — an off-root write through remote_shell needs approval, not a silent block', () => {
  it('names the path and refuses when nothing approved it', async () => {
    const deps = shellDeps(ROOT)
    const result = await executeRemoteShell(deps, {
      server_id: SERVER,
      command: 'echo hi > /etc/os-release'
    })
    expect(result.ok).toBe(false)
    expect(result.blocked).toBe(true)
    expect(result.content).toMatch(/outside project root: \/etc\/os-release/)
    expect(deps.commands).toEqual([])
  })

  it('runs it after the user approved it in the approval gate', async () => {
    const asked: string[] = []
    const gate = createApprovalGate({
      mode: 'full',
      remoteProjectRoot: ROOT,
      requestApproval: async (_action, reason) => {
        asked.push(String(reason))
        return { approved: true }
      }
    })
    const deps = shellDeps(ROOT)
    const act = action('echo hi > /etc/os-release')
    expect(await gate(act)).toBe(true)
    // Full mode would have auto-approved a plain write; this one is escalated, once.
    expect(asked).toEqual(['outside_project_root'])
    const result = await new RemoteShellToolExecutor(deps).execute(act)
    expect(result.ok).toBe(true)
    expect(deps.commands).toEqual([`cd '${ROOT}' && echo hi > /etc/os-release`])
  })

  it('leaves it refused when the user declined', async () => {
    const gate = createApprovalGate({
      mode: 'full',
      remoteProjectRoot: ROOT,
      requestApproval: async () => ({ approved: false })
    })
    const deps = shellDeps(ROOT)
    const act = action('echo hi > /etc/os-release')
    expect(await gate(act)).toBe(false)
    const result = await new RemoteShellToolExecutor(deps).execute(act)
    expect(result.ok).toBe(false)
    expect(deps.commands).toEqual([])
  })

  it('does not escalate a write that stays inside the root', () => {
    expect(escapedWritePaths('echo hi > notes.txt', ROOT)).toEqual([])
    expect(escapedWritePaths(`echo hi > ${ROOT}/notes.txt`, ROOT)).toEqual([])
    expect(escapedWritePaths('ls /opt/zoonestore', ROOT)).toEqual([])
  })

  it('finds the off-root path in a write-shaped command', () => {
    expect(escapedWritePaths('echo hi > /etc/os-release', ROOT)).toEqual(['/etc/os-release'])
    expect(escapedWritePaths('cd .. && echo hi > x', ROOT)).toEqual(['..'])
  })

  it('keeps a write inside the project free of an approval when the mode allows writes', () => {
    const gate = createApprovalGate({
      mode: 'full',
      remoteProjectRoot: ROOT,
      requestApproval: async () => {
        throw new Error('must not ask for an in-root write in full mode')
      }
    })
    const deps = shellDeps(ROOT)
    const act = action('echo hi > notes.txt')
    return gate(act).then(async (allowed) => {
      expect(allowed).toBe(true)
      const result = await new RemoteShellToolExecutor(deps).execute(act)
      expect(result.ok).toBe(true)
    })
  })
})

describe('S1 — the guards that still hold on a remote host', () => {
  it('still refuses a destructive command through the deny list', async () => {
    expect(checkDenyList('rm -rf /').blocked).toBe(true)
    const deps = shellDeps(ROOT)
    const result = await executeRemoteShell(deps, { server_id: SERVER, command: 'rm -rf /' })
    expect(result.ok).toBe(false)
    expect(result.blocked).toBe(true)
    expect(deps.commands).toEqual([])
  })

  it('still refuses a privileged system file through the secret guard', async () => {
    expect(findSecretPathsInCommand('cat /etc/shadow')).not.toEqual([])
    const deps = shellDeps(ROOT)
    const result = await executeRemoteShell(deps, {
      server_id: SERVER,
      command: 'cat /etc/shadow'
    })
    expect(result.ok).toBe(false)
    expect(result.blocked).toBe(true)
    expect(deps.commands).toEqual([])
  })
})

describe('S1.4 — the same commands on THIS machine keep the old containment rule', () => {
  it.each(LOCAL_REFUSED.map((fixture) => [fixture.label, fixture.command] as const))(
    'refuses locally, where the project root is a boundary: %s',
    (_label, command) => {
      expect(enforceCommandPaths(command, ROOT).ok).toBe(false)
    }
  )

  it('does not refuse locally a command that names no path at all', () => {
    // Old rule: there is nothing to contain, so the command is admitted.
    expect(enforceCommandPaths(FIXTURES[5]!.command, ROOT).ok).toBe(true)
    // Same reason for `find /`: the only `/` is a bare root or glued to a glob, and the local
    // guard has always required a token-leading slash. Unchanged by S1.
    expect(enforceCommandPaths(FIXTURES[0]!.command, ROOT).ok).toBe(true)
  })

  it('still refuses locally a find that names a token-leading absolute root', () => {
    expect(
      enforceCommandPaths('find /opt -maxdepth 2 -name golden 2>/dev/null | head -40', ROOT).ok
    ).toBe(false)
  })

  it('keeps the .. and control-character rules on the local command', () => {
    expect(enforceCommandPaths('cd .. && cat etc/passwd', ROOT).ok).toBe(false)
    expect(enforceProjectPath('/opt/sepehr-motor/file\x00.txt', ROOT).ok).toBe(false)
  })
})
