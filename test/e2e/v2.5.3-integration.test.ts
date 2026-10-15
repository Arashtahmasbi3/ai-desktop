import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { AgentOrchestrator, type ProviderEntry } from '@core/agent-orchestrator'
import type { ToolExecutor } from '@core/agent/tools'
import type { AgentAction } from '@shared/agent'
import { planRemoteRuntime } from '../../src/main/agent-service'
import type { RemoteHost } from '../../src/main/agent-service'
import { createDiagnosticPolicy } from '@core/remote/diagnostic-policy'
import { ScriptedAdapter, toolCall } from '../helpers/fake-adapter'
import { createLocalManager } from '../helpers/local-sandbox-manager'

/**
 * v2.5.3 integration - Diagnostic Mode + smarter prompt + retry strategy over the
 * real orchestrator, executors and containment policy. Only the LLM boundary is
 * scripted and the SSH host is faked; nothing inside the app is mocked.
 */
const ROOT = '/opt/demo-project'
const SERVERS = ['srv-1']

let base: string
let projectDir: string

beforeEach(async () => {
  base = await fs.mkdtemp(join(tmpdir(), 'v253-integration-'))
  projectDir = join(base, 'project')
  await fs.mkdir(projectDir, { recursive: true })
})

afterEach(async () => {
  await fs.rm(base, { recursive: true, force: true })
})

function entry(adapter: ScriptedAdapter): ProviderEntry {
  return { provider: adapter.provider, adapter, config: { apiKey: 'test-key', model: 'test-model' } }
}

interface HostSpy {
  host: RemoteHost
  commands: string[]
  reads: string[]
  writes: Array<{ path: string; content: string }>
}

function makeHost(): HostSpy {
  const commands: string[] = []
  const reads: string[] = []
  const writes: Array<{ path: string; content: string }> = []
  const host: RemoteHost = {
    connectedServers: () => SERVERS,
    exec: async (_serverId, command) => {
      commands.push(command)
      return { ok: true, stdout: '', stderr: '', exitCode: 0 }
    },
    readFile: async (_serverId, path) => {
      reads.push(path)
      return 'NAME="Ubuntu"\nVERSION="22.04"'
    },
    writeFile: async (_serverId, path, content) => {
      writes.push({ path, content })
    },
    listFiles: async () => [],
    resolveServer: async () => ({ host: 'h.example', port: 22, username: 'root' }),
    recordAudit: async (entry) => entry
  }
  return { host, commands, reads, writes }
}

/** Counts how many times the executor was actually reached for a call. */
function counting(inner: ToolExecutor, counter: { n: number }): ToolExecutor {
  return {
    async execute(action: AgentAction, options) {
      counter.n += 1
      return inner.execute(action, options)
    }
  }
}

function systemPrompt(adapter: ScriptedAdapter): string {
  const message = adapter.calls[0]?.messages.find((entry) => entry.role === 'system')
  return message?.content ?? ''
}

describe('v2.5.3 integration', () => {
  it('answers "which project am I on?" from context without any tool call', async () => {
    const spy = makeHost()
    const runtime = planRemoteRuntime('status?', 'srv-1', spy.host, undefined, ['remote_shell'], ROOT)
    const adapter = new ScriptedAdapter('deepseek', [
      { content: 'پروژه demo-project روی VPS my-server در مسیر /opt/demo-project' }
    ])
    const manager = createLocalManager(base)
    const orchestrator = new AgentOrchestrator({
      sandbox: manager,
      providers: [entry(adapter)],
      sandboxOptions: { workspaceRoot: projectDir },
      extraTools: runtime.extraTools,
      extraExecutor: runtime.extraExecutor,
      remoteContext: {
        projectName: 'demo-project',
        projectPath: ROOT,
        vpsId: 'srv-1',
        vpsName: 'my-server',
        environment: 'production'
      }
    })

    const result = await orchestrator.run('الان به چه پروژهای متصل هستی؟')

    expect(result.status).toBe('completed')
    // The model was told the context up front...
    const prompt = systemPrompt(adapter)
    expect(prompt).toContain('demo-project')
    expect(prompt).toContain(ROOT)
    expect(prompt).toContain('my-server')
    expect(prompt).toContain('production')
    // ...and answered directly: a single turn, no tool activity at all.
    expect(result.steps).toHaveLength(1)
    expect(result.steps[0].observations).toHaveLength(0)
    expect(spy.commands).toEqual([])
    expect(spy.reads).toEqual([])

    await manager.dispose()
  })

  it('rejects a blocked path on the second attempt instead of retrying it', async () => {
    const spy = makeHost()
    const runtime = planRemoteRuntime('diagnose the crash', 'srv-1', spy.host, undefined, ['remote_shell'], ROOT)
    const adapter = new ScriptedAdapter('deepseek', [
      { toolCalls: [toolCall('remote_read_file', { server_id: 'srv-1', path: '/etc/os-release' })] },
      { toolCalls: [toolCall('remote_read_file', { server_id: 'srv-1', path: '/etc/os-release' })] },
      { content: 'The path is off-limits; I will ask for Diagnostic Mode.' }
    ])
    const manager = createLocalManager(base)
    const counter = { n: 0 }
    const orchestrator = new AgentOrchestrator({
      sandbox: manager,
      providers: [entry(adapter)],
      sandboxOptions: { workspaceRoot: projectDir },
      extraTools: runtime.extraTools,
      extraExecutor: counting(runtime.extraExecutor!, counter)
    })

    const result = await orchestrator.run('تحلیل کن')

    // Both turns were attempted, but the executor only ever saw the first: the
    // detector blocked the retry before it could run again (Fix 5).
    expect(result.steps).toHaveLength(3)
    expect(counter.n).toBe(1)

    const first = result.steps[0].observations[0]
    expect(first.ok).toBe(false)
    const second = result.steps[1].observations[0]
    expect(second.ok).toBe(false)
    expect(second.error ?? second.output).toMatch(/blocked before/i)
    // P0-2 refused the path before any SFTP read happened.
    expect(spy.reads).toEqual([])

    await manager.dispose()
  })

  it('reads /etc/os-release when Diagnostic Mode is ON', async () => {
    const spy = makeHost()
    const runtime = planRemoteRuntime(
      'diagnose the crash',
      'srv-1',
      spy.host,
      undefined,
      ['remote_shell'],
      ROOT,
      createDiagnosticPolicy()
    )
    const adapter = new ScriptedAdapter('deepseek', [
      { toolCalls: [toolCall('remote_read_file', { server_id: 'srv-1', path: '/etc/os-release' })] },
      { content: 'Ubuntu 22.04.' }
    ])
    const manager = createLocalManager(base)
    const orchestrator = new AgentOrchestrator({
      sandbox: manager,
      providers: [entry(adapter)],
      sandboxOptions: { workspaceRoot: projectDir },
      extraTools: runtime.extraTools,
      extraExecutor: runtime.extraExecutor,
      diagnosticMode: () => true
    })

    const result = await orchestrator.run('تحلیل کن')

    expect(result.status).toBe('completed')
    const read = result.steps[0].observations[0]
    expect(read.ok).toBe(true)
    expect(read.output).toContain('Ubuntu')
    expect(spy.reads).toEqual(['/etc/os-release'])

    await manager.dispose()
  })

  it('rejects /etc/os-release when Diagnostic Mode is OFF', async () => {
    const spy = makeHost()
    const runtime = planRemoteRuntime('diagnose the crash', 'srv-1', spy.host, undefined, ['remote_shell'], ROOT)
    const adapter = new ScriptedAdapter('deepseek', [
      { toolCalls: [toolCall('remote_read_file', { server_id: 'srv-1', path: '/etc/os-release' })] },
      { content: 'Enable Diagnostic Mode and I will read it.' }
    ])
    const manager = createLocalManager(base)
    const orchestrator = new AgentOrchestrator({
      sandbox: manager,
      providers: [entry(adapter)],
      sandboxOptions: { workspaceRoot: projectDir },
      extraTools: runtime.extraTools,
      extraExecutor: runtime.extraExecutor,
      diagnosticMode: () => false
    })

    const result = await orchestrator.run('تحلیل کن')

    const read = result.steps[0].observations[0]
    expect(read.ok).toBe(false)
    expect(read.error ?? read.output).toMatch(/Blocked/)
    expect(spy.reads).toEqual([])

    await manager.dispose()
  })
})
