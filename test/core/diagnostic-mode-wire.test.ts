import { describe, it, expect } from 'vitest'
import { planRemoteRuntime } from '../../src/main/agent-service'
import type { RemoteHost } from '../../src/main/agent-service'
import { createDiagnosticPolicy } from '@core/remote/diagnostic-policy'
import { action } from './v24-host'

/**
 * v2.5.3 Fix 4 - the diagnostic policy must flow from the run into the remote
 * shell/file executors so Diagnostic Mode actually widens (and only read-only)
 * the P0-2 confinement the tools enforce.
 *
 * X8: that widening only ever mattered while containment applied to shell commands. A
 * `remote_shell` payload is not a file-tool path any more, so the shell reads the host with
 * or without a policy; the FILE tools are where the policy still decides, and a write-shaped
 * shell command keeps its containment (the third case below).
 */
const ROOT = '/opt/demo-project'
const SERVERS = ['srv-1']

function fakeHost(calls: Array<{ command: string }>): RemoteHost {
  return {
    connectedServers: () => SERVERS,
    exec: async (_serverId, command) => {
      calls.push({ command })
      return { ok: true, stdout: '', stderr: '', exitCode: 0 }
    },
    readFile: async () => '',
    writeFile: async () => undefined,
    listFiles: async () => [],
    resolveServer: async () => ({ host: 'h.example', port: 22, username: 'root' }),
    recordAudit: async (entry) => entry
  }
}

function runShell(runtime: ReturnType<typeof planRemoteRuntime>, command: string) {
  return runtime.extraExecutor!.execute(
    action('remote_shell', { server_id: 'srv-1', command })
  )
}

describe('Diagnostic Mode wiring - remote shell', () => {
  it('reads a host system path without a diagnostic policy (X8)', async () => {
    const calls: Array<{ command: string }> = []
    const runtime = planRemoteRuntime('diagnose the crash', 'srv-1', fakeHost(calls), undefined, undefined, ROOT)
    const result = await runShell(runtime, 'cat /etc/os-release')
    // X8: the shell may inspect the host it runs on; the policy still governs the file tools.
    expect(result.ok).toBe(true)
    expect(calls.map((c) => c.command)).toContain(`cd '${ROOT}' && cat /etc/os-release`)
  })

  it('runs a read-only system command while diagnostic is active', async () => {
    const calls: Array<{ command: string }> = []
    const runtime = planRemoteRuntime(
      'diagnose the crash',
      'srv-1',
      fakeHost(calls),
      undefined,
      undefined,
      ROOT,
      createDiagnosticPolicy()
    )
    const result = await runShell(runtime, 'cat /etc/os-release')
    expect(result.ok).toBe(true)
    // v2.6.5: the command is run from the project root so a relative path cannot
    // resolve against the login directory.
    expect(calls.map((c) => c.command)).toContain(`cd '${ROOT}' && cat /etc/os-release`)
  })

  it('still refuses a write to a system path while diagnostic is active', async () => {
    const calls: Array<{ command: string }> = []
    const runtime = planRemoteRuntime(
      'diagnose the crash',
      'srv-1',
      fakeHost(calls),
      undefined,
      undefined,
      ROOT,
      createDiagnosticPolicy()
    )
    const result = await runShell(runtime, 'echo hi > /etc/os-release')
    expect(result.ok).toBe(false)
    expect(calls).toHaveLength(0)
  })
})

describe('Diagnostic Mode wiring - remote file tools', () => {
  it('read is allowed and write is refused for an exposed path', async () => {
    const calls: Array<{ command: string }> = []
    const runtime = planRemoteRuntime(
      'diagnose the crash',
      'srv-1',
      fakeHost(calls),
      undefined,
      undefined,
      ROOT,
      createDiagnosticPolicy()
    )
    const read = await runtime.extraExecutor!.execute(
      action('remote_read_file', { server_id: 'srv-1', path: '/etc/os-release' })
    )
    expect(read.ok).toBe(true)

    const write = await runtime.extraExecutor!.execute(
      action('remote_write_file', { server_id: 'srv-1', path: '/etc/os-release', content: 'x' })
    )
    expect(write.ok).toBe(false)
    expect(write.error ?? write.output).toMatch(/Blocked/)
  })
})
