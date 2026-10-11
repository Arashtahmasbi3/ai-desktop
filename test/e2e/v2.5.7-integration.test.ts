import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { AgentOrchestrator } from '@core/agent-orchestrator'
import type { ProviderEntry } from '@core/agent-orchestrator'
import { TaskPlanner } from '@core/agent/task-planner'
import { LoopDetector } from '@core/agent/loop-detector'
import { findAlternatives } from '@core/agent/strategies'
import { REMOTE_SHELL_TOOL } from '@core/tools/remote-shell-tool'
import { RemoteShellToolExecutor } from '@core/tools/remote-shell-executor'
import { SANDBOX_TOOLS } from '@core/agent/tools'
import type { AgentToolResult } from '@shared/agent'
import type { TaskPlannerEvent } from '@shared/task-plan'
import { ScriptedAdapter, toolCall } from '../helpers/fake-adapter'
import { createLocalManager } from '../helpers/local-sandbox-manager'

let base: string

beforeEach(async () => {
  base = await fs.mkdtemp(join(tmpdir(), 'v257-'))
})

afterEach(async () => {
  await fs.rm(base, { recursive: true, force: true })
})

function entry(adapter: ScriptedAdapter): ProviderEntry {
  return { provider: adapter.provider, adapter, config: { apiKey: 'k', model: 'm' } }
}

function ok(output: string): AgentToolResult {
  return { actionId: 'a', name: 'remote_shell', ok: true, output, attempts: 1, durationMs: 1 }
}

/**
 * v2.5.7 integration - the planner and the loop redirect work on real code paths.
 */
describe('v2.5.7 integration - task planning end to end', () => {
  it('1. a complex goal produces a plan and executes it step by step', async () => {
    const events: TaskPlannerEvent[] = []
    const executed: string[] = []
    const replies = [
      JSON.stringify({
        steps: [
          { description: 'List services', toolName: 'remote_shell', args: { command: 'systemctl --failed' } },
          { description: 'Check memory', toolName: 'remote_shell', args: { command: 'free -h' } }
        ]
      })
    ]
    const planner = new TaskPlanner({
      callLLM: async () => replies.shift() ?? '',
      execute: async (tool, args) => {
        executed.push(`${tool}:${String(args.command)}`)
        return { ...ok('done'), name: tool }
      },
      onEvent: (event) => events.push(event),
      generateId: (() => { let n = 0; return (p = 'id') => `${p}-${(n += 1)}` })()
    })

    const plan = await planner.createPlan('why is the service crash looping and using memory', {
      runId: 'run-1',
      vpsName: 'srv-1'
    })
    expect(plan.status).toBe('planning')
    expect(plan.steps).toHaveLength(2)

    const done = await planner.executePlan(plan, { runId: 'run-1' })
    expect(done.status).toBe('completed')
    expect(done.steps.every((step) => step.status === 'done')).toBe(true)
    expect(executed).toEqual(['remote_shell:systemctl --failed', 'remote_shell:free -h'])
    expect(events.map((event) => event.type)).toContain('task:plan')
    expect(events.at(-1)?.type).toBe('task:complete')
  })

  it('2. a real orchestrator run redirects a loop to an alternative command', async () => {
    const manager = createLocalManager(base)
    const commands: string[] = []
    const deps = {
      connectedServers: () => ['srv-1'],
      exec: async (_server: string, command: string) => {
        commands.push(command)
        if (command.includes('pm2')) {
          return { ok: false, stdout: '', stderr: 'pm2: command not found', exitCode: 127 }
        }
        return { ok: true, stdout: '0 loaded units listed.', stderr: '', exitCode: 0 }
      }
    }
    const adapter = new ScriptedAdapter('deepseek', [
      { toolCalls: [toolCall('remote_shell', { server_id: 'srv-1', command: 'pm2 list' })] },
      { toolCalls: [toolCall('remote_shell', { server_id: 'srv-1', command: 'pm2 list' })] },
      { toolCalls: [toolCall('remote_shell', { server_id: 'srv-1', command: 'pm2 list' })] },
      { toolCalls: [toolCall('remote_shell', { server_id: 'srv-1', command: 'systemctl --failed' })] },
      { content: 'PM2 is unavailable; systemd shows no failed units.' }
    ])
    const orchestrator = new AgentOrchestrator({
      sandbox: manager,
      providers: [entry(adapter)],
      extraTools: [REMOTE_SHELL_TOOL],
      extraExecutor: new RemoteShellToolExecutor(deps, 'srv-1')
    })

    const result = await orchestrator.run('why is pm2 not working?')

    expect(result.status).toBe('completed')
    expect(result.finalAnswer).toContain('systemd')
    // The third identical call was redirected, not executed.
    expect(commands).toEqual(['pm2 list', 'pm2 list', 'systemctl --failed'])
    const observations = result.steps.flatMap((step) => step.observations)
    expect(observations.some((observation) => observation.code === 'redirect')).toBe(true)
    const redirect = observations.find((observation) => observation.code === 'redirect')
    expect(redirect?.error).toContain('systemctl')
    await manager.dispose()
  })

  it('3. the loop detector used by the run is the shared strategy-aware one', () => {
    const detector = new LoopDetector(
      {},
      { findAlternative: (tool, args, error) => findAlternatives(tool, args, error) }
    )
    detector.beforeToolCall('remote_shell', { command: 'cat /etc/os-release' })
    detector.afterToolCall(
      'remote_shell',
      { ok: false, blocked: true, error: 'Blocked: path is outside project root' },
      { command: 'cat /etc/os-release' }
    )
    const decision = detector.beforeToolCall('remote_shell', { command: 'cat /etc/os-release' })
    expect(decision.action).toBe('redirect')
    expect(decision.alternative?.args.command).toBe('uname -a')
    expect(SANDBOX_TOOLS.length).toBeGreaterThan(0)
  })
})
