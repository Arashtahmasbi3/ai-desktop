import { describe, it, expect } from 'vitest'
import {
  DEFAULT_LOG_TAIL,
  DiagnosticsToolExecutor,
  MAX_LOG_TAIL,
  NAMED_DIAGNOSTIC_TOOLS,
  buildDiagnosticCommand,
  buildDiskUsageCommand,
  buildProcessListCommand,
  buildServiceLogsCommand,
  buildSystemHealthCommand,
  normalizeFilter,
  normalizeService,
  normalizeTail
} from '@core/tools/diagnostics-tools'
import type { AgentAction } from '@shared/agent'
import type { VpsExecResult } from '@shared/vps'
import { planRemoteRuntime } from '../../src/main/agent-service'

function action(name: string, args: Record<string, unknown>, valid = true): AgentAction {
  return {
    id: `a-${name}`,
    name,
    arguments: args,
    rawArguments: JSON.stringify(args),
    valid,
    signature: `${name}:${JSON.stringify(args)}`
  }
}

function ok(stdout = 'output', exitCode = 0): VpsExecResult {
  return { ok: exitCode === 0, stdout, stderr: '', exitCode }
}

function execFor(calls: string[]) {
  return async (_serverId: string, command: string): Promise<VpsExecResult> => {
    calls.push(command)
    return ok(`ran:${command.slice(0, 20)}`)
  }
}

describe('named diagnostic tool definitions (T2.3)', () => {
  it('exposes exactly the four named probes', () => {
    expect(NAMED_DIAGNOSTIC_TOOLS.map((tool) => tool.name).sort()).toEqual([
      'get_disk_usage',
      'get_process_list',
      'get_service_logs',
      'get_system_health'
    ])
  })

  it('requires server_id on every tool and never allows extra properties', () => {
    for (const tool of NAMED_DIAGNOSTIC_TOOLS) {
      expect(tool.parameters.required, tool.name).toContain('server_id')
      expect(tool.parameters.additionalProperties, tool.name).toBe(false)
    }
  })
})

describe('argument normalization', () => {
  it('clamps the log tail into [1, MAX_LOG_TAIL]', () => {
    expect(normalizeTail(undefined)).toBe(DEFAULT_LOG_TAIL)
    expect(normalizeTail(0)).toBe(1)
    expect(normalizeTail(50)).toBe(50)
    expect(normalizeTail(999_999)).toBe(MAX_LOG_TAIL)
    expect(normalizeTail('nonsense')).toBe(DEFAULT_LOG_TAIL)
  })

  it('accepts plain service names and rejects shell metacharacters', () => {
    expect(normalizeService('nginx')).toBe('nginx')
    expect(normalizeService('api@1.service')).toBe('api@1.service')
    expect(normalizeService('nginx; rm -rf /')).toBeUndefined()
    expect(normalizeService('$(whoami)')).toBeUndefined()
    expect(normalizeService('a b')).toBeUndefined()
  })

  it('accepts a narrow filter alphabet and rejects injection', () => {
    expect(normalizeFilter('node')).toBe('node')
    expect(normalizeFilter('my app')).toBe('my app')
    expect(normalizeFilter('a;b')).toBeUndefined()
    expect(normalizeFilter('x`id`')).toBeUndefined()
  })
})

describe('command builders stay read-only and quoted', () => {
  it('quotes the service and caps every log section', () => {
    const command = buildServiceLogsCommand('nginx', 25)
    expect(command).toContain(`'nginx'`)
    expect(command).toContain('systemctl status')
    expect(command).toContain('journalctl -u')
    expect(command).toContain('pm2 logs')
    expect(command.match(/head -n 25/g)).toHaveLength(3)
    expect(command).not.toMatch(/\brm\b|\bsed -i\b|>>?[^&]/)
  })

  it('escapes a single quote inside a service name', () => {
    expect(buildServiceLogsCommand("ng'inx", 10)).toContain(`'ng'\\''inx'`)
  })

  it('reports du and df for the target directory', () => {
    const command = buildDiskUsageCommand('/srv/app')
    expect(command).toContain(`du -sh -- '/srv/app'`)
    expect(command).toContain(`df -h -- '/srv/app'`)
  })

  it('collects kernel, uptime, load, memory and disk for health', () => {
    const command = buildSystemHealthCommand()
    for (const probe of ['uname -a', 'uptime', 'cat /proc/loadavg', 'free -h', 'df -h']) {
      expect(command).toContain(probe)
    }
  })

  it('sorts the unfiltered process list and greps out its own match line', () => {
    expect(buildProcessListCommand()).toContain('ps aux --sort=-%cpu')
    const filtered = buildProcessListCommand('node')
    expect(filtered).toContain(`grep -i -- 'node'`)
    expect(filtered).toContain('grep -v grep')
  })
})

describe('buildDiagnosticCommand validation', () => {
  it('refuses an injected service name and an unsafe filter', () => {
    const service = buildDiagnosticCommand('get_service_logs', { service: 'x; reboot' })
    expect(service.ok).toBe(false)
    const filter = buildDiagnosticCommand('get_process_list', { filter: 'a`b`' })
    expect(filter.ok).toBe(false)
  })

  it('blocks a secret path for disk usage (secret guard always on)', () => {
    const result = buildDiagnosticCommand('get_disk_usage', { path: '/srv/app/.env' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/Blocked/)
  })

  it('labels an unknown tool instead of building a command', () => {
    expect(buildDiagnosticCommand('rm_everything', {}).ok).toBe(false)
  })
})

describe('DiagnosticsToolExecutor', () => {
  const deps = (calls: string[]) => ({
    connectedServers: () => ['vps-1'],
    exec: execFor(calls)
  })

  it('runs the built command on the pinned server and returns its output', async () => {
    const calls: string[] = []
    const executor = new DiagnosticsToolExecutor(deps(calls), 'vps-1')
    const result = await executor.execute(action('get_system_health', {}))
    expect(result.ok).toBe(true)
    expect(result.serverId).toBe('vps-1')
    expect(calls).toHaveLength(1)
    expect(calls[0]).toContain('uname -a')
  })

  it('runs on the pinned server when the model omits server_id', async () => {
    const calls: string[] = []
    const executor = new DiagnosticsToolExecutor(deps(calls), 'vps-1')
    const result = await executor.execute(action('get_system_health', {}))
    expect(result.ok).toBe(true)
    expect(result.serverId).toBe('vps-1')
    expect(calls).toHaveLength(1)
  })

  /*
   * v3.0: the old contract accepted a different `server_id` and silently ignored it, so the
   * tool returned one machine's data as the answer about another — a real user was told
   * "yoserver's hostname is <spmotor's hostname>" and concluded the two were the same host.
   * Refusing is the honest behaviour: the caller asked about a host this tool won't touch.
   */
  it('refuses a model-supplied server_id that differs from the pinned server', async () => {
    const calls: string[] = []
    const executor = new DiagnosticsToolExecutor(deps(calls), 'vps-1')
    const result = await executor.execute(
      action('get_system_health', { server_id: 'other-host' })
    )

    expect(result.ok).toBe(false)
    expect(result.code).toBe('invalid_arguments')
    // The message must name both hosts and say what to do, or the model just retries.
    expect(result.error).toContain('vps-1')
    expect(result.error).toContain('other-host')
    expect(result.error).toContain('chat header')
    // And it must not have touched either machine.
    expect(calls).toHaveLength(0)
  })

  it('still honours the requested server when none is pinned', async () => {
    // No pinned server (the user has not selected one): the model's choice is all we have,
    // so it is used and validated against the connected set as before.
    const calls: string[] = []
    const executor = new DiagnosticsToolExecutor({
      connectedServers: () => ['vps-1', 'vps-2'],
      exec: execFor(calls)
    })
    const result = await executor.execute(
      action('get_system_health', { server_id: 'vps-2' })
    )
    expect(result.ok).toBe(true)
    expect(result.serverId).toBe('vps-2')
  })

  it('uses the project root as the default disk target', async () => {
    const calls: string[] = []
    const executor = new DiagnosticsToolExecutor(
      { connectedServers: () => ['vps-1'], exec: execFor(calls), projectRoot: '/srv/app' },
      'vps-1'
    )
    await executor.execute(action('get_disk_usage', {}))
    expect(calls[0]).toContain(`du -sh -- '/srv/app'`)
  })

  it('rejects a malformed action and an unknown tool', async () => {
    const calls: string[] = []
    const executor = new DiagnosticsToolExecutor(deps(calls), 'vps-1')
    const malformed = await executor.execute(action('get_system_health', {}, false))
    expect(malformed.code).toBe('invalid_arguments')
    const unknown = await executor.execute(action('write_file', {}))
    expect(unknown.code).toBe('unknown_tool')
    expect(calls).toHaveLength(0)
  })

  it('refuses an unconnected server', async () => {
    const executor = new DiagnosticsToolExecutor(deps([]))
    const result = await executor.execute(action('get_system_health', { server_id: 'vps-9' }))
    expect(result.code).toBe('remote_error')
  })

  it('refuses injected arguments before touching the host', async () => {
    const calls: string[] = []
    const executor = new DiagnosticsToolExecutor(deps(calls), 'vps-1')
    const result = await executor.execute(
      action('get_service_logs', { service: 'nginx && shutdown -h now' })
    )
    expect(result.code).toBe('invalid_arguments')
    expect(calls).toHaveLength(0)
  })
})

describe('named diagnostics are wired into the remote runtime (T2.3)', () => {
  function host() {
    return {
      connectedServers: () => ['srv-1'],
      exec: async (): Promise<VpsExecResult> => ok('live output')
    }
  }

  it('offers all four probes once a VPS is explicitly selected', () => {
    const runtime = planRemoteRuntime('inspect the box', 'srv-1', host())
    const names = (runtime.extraTools ?? []).map((tool) => tool.name)
    for (const name of [
      'get_service_logs',
      'get_disk_usage',
      'get_system_health',
      'get_process_list'
    ]) {
      expect(names, name).toContain(name)
    }
    expect(runtime.systemHint).toMatch(/get_service_logs/)
  })

  it('routes a probe call to the host and returns its output', async () => {
    const runtime = planRemoteRuntime('inspect the box', 'srv-1', host())
    const result = await runtime.extraExecutor!.execute(action('get_system_health', {}))
    expect(result.ok).toBe(true)
    expect(result.output).toBe('live output')
    expect(result.serverId).toBe('srv-1')
  })
})
