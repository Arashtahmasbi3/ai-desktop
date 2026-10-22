/**
 * S2 — a refusal must say which rule refused it and offer a way forward.
 *
 * The user's complaint was the sentence itself: `Blocked: Path "/opt/zoonestore/apps" is outside
 * project root "/opt/sepehr-motor"` names a boundary, not a rule, and offers no alternative. The
 * brief for S2:
 *
 *   - every refusal names the rule that refused it (`containment`, `deny-list`, `host-policy`,
 *     `approval-required`);
 *   - every refusal offers at least one runnable alternative, in words a user can act on
 *     ("add <path> as a project", "read it with a remote shell command", "approve it once");
 *   - no refusal contains a raw UUID, and none contains a raw tool id.
 *
 * These are assertions about what a person reads, so they run through the same entry points the
 * agent uses — never against a message builder directly.
 */
import { describe, expect, it } from 'vitest'
import type { VpsExecResult } from '@shared/vps'
import { enforceProjectPath } from '../../src/core/remote/path-guard'
import { executeRemoteFs, type RemoteFsDeps } from '../../src/core/tools/remote-fs-tools'
import {
  executeRemoteShell,
  type RemoteShellDeps
} from '../../src/core/tools/remote-shell-tool'

const ROOT = '/opt/sepehr-motor'
const SERVER = 'srv-1'
const UUID = '34c80099-2868-40a1-bef4-9b23d865db0b'

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
/** A raw tool id is an internal name, not the sentence we show a person. */
const TOOL_ID_RE =
  /\b(?:read_file|write_file|list_dir|run_command|remote_shell|remote_read_file|remote_write_file|remote_list_dir|remote_grep|remote_exists|remote_git_status)\b|remote_[a-z]+_[a-z]+/

function shellDeps(
  result?: Partial<VpsExecResult>,
  projectRoot?: string
): RemoteShellDeps & { commands: string[] } {
  const commands: string[] = []
  const deps: RemoteShellDeps & { commands: string[] } = {
    commands,
    connectedServers: () => [SERVER],
    exec: async (_serverId, command): Promise<VpsExecResult> => {
      commands.push(command)
      return {
        ok: true,
        stdout: '',
        stderr: '',
        exitCode: 0,
        ...result
      }
    }
  }
  if (projectRoot) deps.projectRoot = projectRoot
  return deps
}

function fsDeps(projectRoot?: string): RemoteFsDeps & { reads: string[] } {
  const reads: string[] = []
  const deps: RemoteFsDeps & { reads: string[] } = {
    reads,
    connectedServers: () => [SERVER],
    readFile: async (_serverId, path) => {
      reads.push(path)
      return 'content'
    },
    writeFile: async () => undefined,
    listFiles: async () => [],
    exec: async (): Promise<VpsExecResult> => ({ ok: true, stdout: '', stderr: '', exitCode: 0 })
  }
  if (projectRoot) deps.projectRoot = projectRoot
  return deps
}

/** Every property S2 promises, asserted on one refusal. */
function expectUnderstandableRefusal(message: string, rule: string): void {
  expect(message).toContain(rule)
  expect(message).not.toMatch(UUID_RE)
  expect(message).not.toMatch(TOOL_ID_RE)
}

describe('S2.1/S2.2 — the containment refusal', () => {
  it('names the rule and offers adding the path as a project', () => {
    const { error } = enforceProjectPath('/opt/zoonestore/package.json', ROOT)
    const message = String(error)
    expectUnderstandableRefusal(message, 'containment')
    expect(message).toContain('outside project root')
    // At least one runnable alternative, phrased for a user.
    expect(message).toMatch(/add .* as a project/i)
    expect(message).toMatch(/remote shell command/i)
    expect(message).toMatch(/allow .* once|approve .* once/i)
  })

  it('carries the same sentence through a file tool', async () => {
    const result = await executeRemoteFs(fsDeps(ROOT), 'remote_read_file', {
      server_id: SERVER,
      path: '/opt/zoonestore/package.json'
    })
    expect(result.ok).toBe(false)
    expectUnderstandableRefusal(result.content, 'containment')
    expect(result.content).toMatch(/add .* as a project/i)
  })

  it('offers "use a path inside the project" for a local sandbox escape', async () => {
    // The local file tools are contained by the sandbox workspace, a different boundary with a
    // different fix; the alternative must match that fix.
    const { PathEscapeError } = await import('../../src/core/sandbox/errors')
    const message = new PathEscapeError('../../etc/passwd').message
    expectUnderstandableRefusal(message, 'containment')
    expect(message).toMatch(/inside the project/i)
  })
})

describe('S2.1/S2.2 — the deny-list refusal', () => {
  it('names the rule and the always-on alternative', async () => {
    const result = await executeRemoteShell(shellDeps(), {
      server_id: SERVER,
      command: 'rm -rf /'
    })
    expect(result.ok).toBe(false)
    expect(result.blocked).toBe(true)
    expectUnderstandableRefusal(result.content, 'deny-list')
    expect(result.content).toMatch(/policy/i)
    expect(result.content).toMatch(/reword|rewrite|rephrase/i)
  })

  it('names the rule for a secret path too', async () => {
    const result = await executeRemoteFs(fsDeps(ROOT), 'remote_read_file', {
      server_id: SERVER,
      path: '/opt/zoonestore/.env'
    })
    expect(result.ok).toBe(false)
    expect(result.blocked).toBe(true)
    expect(result.content).toMatch(/deny-list|secret-path/i)
    expect(result.content).not.toMatch(UUID_RE)
    expect(result.content).not.toMatch(TOOL_ID_RE)
    expect(result.content).toMatch(/always on/i)
  })
})

describe('S2.1/S2.2 — the host-policy refusals', () => {
  it('names host-policy and offers changing the policy', async () => {
    const result = await executeRemoteShell(
      shellDeps({ ok: false, blocked: true, reason: 'read-only hosts are read-only: mutations are blocked.' }),
      { server_id: SERVER, command: 'mkdir /x' }
    )
    expect(result.ok).toBe(false)
    expect(result.blocked).toBe(true)
    expectUnderstandableRefusal(result.content, 'host-policy')
    expect(result.content).toMatch(/Settings -> Connections|read-only command/i)
  })

  it('never echoes a UUID that the policy reason happened to carry', async () => {
    const result = await executeRemoteShell(
      shellDeps({ ok: false, blocked: true, reason: `server ${UUID} is read-only` }),
      { server_id: SERVER, command: 'mkdir /x' }
    )
    expect(result.content).not.toMatch(UUID_RE)
    expect(result.content).toMatch(/host-policy/)
  })

  it('names approval-required when the host policy wants a human', async () => {
    const result = await executeRemoteShell(
      shellDeps({ ok: false, requiresApproval: true, reason: 'This host requires approval for write commands.' }),
      { server_id: SERVER, command: 'mkdir /x' }
    )
    expect(result.ok).toBe(false)
    expect(result.blocked).toBe(true)
    expectUnderstandableRefusal(result.content, 'approval-required')
    expect(result.content).toMatch(/approve it once/i)
  })
})

describe('S2.1/S2.2 — the outside-project-root write refusal', () => {
  it('names approval-required, the escaping path, and how to say yes', async () => {
    const result = await executeRemoteShell(shellDeps(undefined, ROOT), {
      server_id: SERVER,
      command: 'echo hi > /etc/os-release'
    })
    expect(result.ok).toBe(false)
    expect(result.blocked).toBe(true)
    expectUnderstandableRefusal(result.content, 'approval-required')
    expect(result.content).toMatch(/outside project root: \/etc\/os-release/)
    expect(result.content).toMatch(/approve it once/i)
  })
})

describe('S2.2 — no raw UUID even when the caller only has the id', () => {
  it('names the server without printing the id it was given', async () => {
    const result = await executeRemoteShell(shellDeps(), { server_id: UUID, command: 'ls' })
    expect(result.ok).toBe(false)
    expect(result.content).toMatch(/not connected/i)
    expect(result.content).not.toMatch(UUID_RE)
  })

  it('names a connection-target refusal without the id', async () => {
    const result = await executeRemoteFs(fsDeps(ROOT), 'remote_read_file', {
      server_id: UUID,
      path: `${ROOT}/package.json`
    })
    expect(result.ok).toBe(false)
    expect(result.content).not.toMatch(UUID_RE)
  })
})
