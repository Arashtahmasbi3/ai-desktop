import { describe, it, expect } from 'vitest'
import type { AgentAction } from '@shared/agent'
import { createApprovalGate, shouldRequireApproval } from '@main/approval-gate'
import { isCommandAlwaysAllowed, isReadOnlyShellCommand } from '@core/remote/command-whitelist'
import { planRemoteRuntime } from '../../src/main/agent-service'
import type { RemoteHost } from '../../src/main/agent-service'
import { action } from '../core/v24-host'

const ROOT = '/opt/demo-project'

function shell(command: string, id = `a-${command}`): AgentAction {
  return {
    id,
    name: 'remote_shell',
    arguments: { server_id: 'srv-1', command },
    rawArguments: JSON.stringify({ command }),
    valid: true,
    signature: `remote_shell:${command}`
  }
}

/** Ask-mode gate with a spy recording every prompt (approval reason included). */
function askGate(): { gate: (a: AgentAction) => Promise<boolean>; asked: string[] } {
  const asked: string[] = []
  const gate = createApprovalGate({
    mode: 'ask',
    requestApproval: async (a) => {
      asked.push(a.name)
      return { approved: true }
    }
  })
  return { gate, asked }
}

function fakeHost(calls: string[]): RemoteHost {
  return {
    connectedServers: () => ['srv-1'],
    exec: async (_serverId, command) => {
      calls.push(command)
      return { ok: true, stdout: '', stderr: '', exitCode: 0 }
    },
    readFile: async () => '',
    writeFile: async () => undefined,
    listFiles: async () => [],
    resolveServer: async () => ({ host: 'h.example', port: 22, username: 'root' }),
    recordAudit: async (entry) => entry
  }
}

/**
 * v2.5.5 Task 2.1 - the v2.5.3 whitelist must bypass the approval prompt.
 *
 * Root cause: approval-gate.ts only consulted requiresApproval + approvedCommands
 * and never asked the command whitelist, so `uname -a` (explicitly allow-listed)
 * still prompted. The bypass relaxes the prompt only: P0-2 containment is still
 * enforced by the remote executors.
 */
describe('Task 2.1 - whitelist bypasses approval', () => {
  it('1. remote_shell "uname -a" needs no approval', async () => {
    const { gate, asked } = askGate()
    expect(await gate(shell('uname -a'))).toBe(true)
    expect(asked).toHaveLength(0)
  })

  it('2. remote_shell "df -h" needs no approval', async () => {
    const { gate, asked } = askGate()
    expect(await gate(shell('df -h'))).toBe(true)
    expect(asked).toHaveLength(0)
  })

  it('3. remote_shell "systemctl status nginx" needs no approval', async () => {
    const { gate, asked } = askGate()
    expect(await gate(shell('systemctl status nginx'))).toBe(true)
    expect(asked).toHaveLength(0)
  })

  it('4. remote_shell "ls /opt/demo-project 2>&1" needs no approval', async () => {
    const { gate, asked } = askGate()
    expect(await gate(shell('ls /opt/demo-project 2>&1'))).toBe(true)
    expect(asked).toHaveLength(0)
  })

  it('7. remote_read_file inside the project root needs no approval', async () => {
    const { gate, asked } = askGate()
    expect(
      await gate(action('remote_read_file', { server_id: 'srv-1', path: `${ROOT}/src/index.ts` }))
    ).toBe(true)
    expect(asked).toHaveLength(0)
  })

  it('8. remote_write_file still needs approval', async () => {
    const { gate, asked } = askGate()
    expect(
      await gate(
        action('remote_write_file', { server_id: 'srv-1', path: `${ROOT}/src/index.ts`, content: 'x' })
      )
    ).toBe(true)
    expect(asked).toEqual(['remote_write_file'])
  })
})

describe('Task 2.1 - dangerous and out-of-root commands are still gated', () => {
  it('5. "rm -rf /" needs approval and is deny-listed', async () => {
    const { gate, asked } = askGate()
    const destructive = shell('rm -rf / --no-preserve-root')
    const requirement = shouldRequireApproval(destructive)
    expect(requirement).toEqual({ required: true, reason: 'dangerous' })
    expect(await gate(destructive)).toBe(true)
    expect(asked).toHaveLength(1)
  })

  it('6. "cat /etc/passwd" skips approval but is BLOCKED by P0-2 at the executor', async () => {
    // The classifier treats `cat` as a read, so no prompt is shown...
    expect(isReadOnlyShellCommand('cat /etc/passwd')).toBe(true)
    const { gate, asked } = askGate()
    expect(await gate(shell('cat /etc/passwd'))).toBe(true)
    expect(asked).toHaveLength(0)

    // ...but P0-2 containment still refuses to run it outside the project root.
    const calls: string[] = []
    const runtime = planRemoteRuntime('why is it slow', 'srv-1', fakeHost(calls), undefined, undefined, ROOT)
    const result = await runtime.extraExecutor!.execute(
      action('remote_shell', { server_id: 'srv-1', command: 'cat /etc/passwd' })
    )
    expect(result.ok).toBe(false)
    expect(result.code).toBe('blocked')
    expect(calls).toHaveLength(0)
  })

  it('keeps the always-allowed whitelist a strict subset of the read-only classifier', () => {
    expect(isCommandAlwaysAllowed('uname -a')).toBe(true)
    expect(isReadOnlyShellCommand('uname -a')).toBe(true)
    // `hostname; uname -a; uptime; nproc` is the real-world case from the ticket.
    expect(isReadOnlyShellCommand('hostname; uname -a; uptime; nproc')).toBe(true)
    // Writes and substitutions are never read-only.
    expect(isReadOnlyShellCommand('ls /tmp > /tmp/out')).toBe(false)
    expect(isReadOnlyShellCommand('ls | tee /tmp/out')).toBe(false)
    expect(isReadOnlyShellCommand('cat $(rm -rf /)')).toBe(false)
    expect(isReadOnlyShellCommand('npm install')).toBe(false)
  })
})
