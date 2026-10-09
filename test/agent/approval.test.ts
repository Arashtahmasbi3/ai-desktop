import { describe, it, expect, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  classifyAction,
  isDangerousAction,
  requiresApproval
} from '@core/agent/approval'
import { PLAN_MODE_HINT } from '@shared/approval'
import { AgentOrchestrator } from '@core/agent-orchestrator'
import type { ProviderEntry } from '@core/agent-orchestrator'
import { ApprovalBroker, summarizeAction } from '@main/approval-broker'
import type { AgentAction } from '@shared/agent'
import type { AgentEvent } from '@shared/ui'
import { ScriptedAdapter, toolCall } from '../helpers/fake-adapter'
import { createLocalManager } from '../helpers/local-sandbox-manager'

const dirs: string[] = []
afterEach(async () => {
  for (const dir of dirs) await fs.rm(dir, { recursive: true, force: true })
  dirs.length = 0
})

async function sandboxDir(): Promise<string> {
  const dir = await fs.mkdtemp(join(tmpdir(), 'approval-'))
  dirs.push(dir)
  return dir
}

function entry(adapter: ScriptedAdapter): ProviderEntry {
  return { provider: adapter.provider, adapter, config: { apiKey: 'test-key', model: 'test-model' } }
}

function action(name: string, args: Record<string, unknown> = {}): AgentAction {
  return {
    id: 'a1',
    name,
    arguments: args,
    rawArguments: JSON.stringify(args),
    valid: true,
    signature: name
  }
}

describe('approval policy', () => {
  it('classifies read, write and shell tools', () => {
    expect(classifyAction({ name: 'read_file', arguments: {} })).toBe('read')
    expect(classifyAction({ name: 'write_file', arguments: {} })).toBe('write')
    expect(classifyAction({ name: 'remote_write_file', arguments: {} })).toBe('write')
    expect(classifyAction({ name: 'run_command', arguments: {} })).toBe('shell')
    expect(classifyAction({ name: 'remote_shell', arguments: {} })).toBe('shell')
  })

  it('treats shell tools and deny-listed arguments as dangerous', () => {
    expect(isDangerousAction({ name: 'run_command', arguments: { command: 'ls' } })).toBe(true)
    expect(isDangerousAction({ name: 'read_file', arguments: { path: '/tmp/x' } })).toBe(false)
    expect(
      isDangerousAction({ name: 'write_file', arguments: { path: '/tmp/x', content: 'rm -rf /' } })
    ).toBe(true)
  })

  it('full mode never asks for ordinary actions', () => {
    for (const name of ['read_file', 'write_file', 'run_command']) {
      expect(requiresApproval('full', { name, arguments: {} })).toBe(false)
    }
  })

  it('auto-write asks for writes and shell commands but not reads', () => {
    expect(requiresApproval('auto-write', { name: 'read_file', arguments: {} })).toBe(false)
    expect(requiresApproval('auto-write', { name: 'write_file', arguments: {} })).toBe(true)
    expect(requiresApproval('auto-write', { name: 'run_command', arguments: {} })).toBe(true)
  })

  it('ask mode asks for every tool call, reads included', () => {
    expect(requiresApproval('ask', { name: 'read_file', arguments: {} })).toBe(true)
    expect(requiresApproval('ask', { name: 'write_file', arguments: {} })).toBe(true)
    expect(requiresApproval('ask', { name: 'run_command', arguments: {} })).toBe(true)
  })

  it('never auto-approves a deny-listed command, even in full mode', () => {
    const destructive = { name: 'run_command', arguments: { command: 'rm -rf /' } }
    expect(requiresApproval('full', destructive)).toBe(true)
    expect(requiresApproval('auto-write', destructive)).toBe(true)
  })
})

describe('ApprovalBroker', () => {
  it('emits a request and resolves when the user approves', async () => {
    const events: AgentEvent[] = []
    const broker = new ApprovalBroker({ emit: (event) => events.push(event) })
    const promise = broker.request('run-1', action('run_command', { command: 'npm test' }))

    const request = events[0]
    expect(request.type).toBe('approval:request')
    if (request.type !== 'approval:request') throw new Error('unreachable')
    expect(request.request.tool).toBe('run_command')
    expect(request.request.summary).toContain('npm test')

    expect(broker.resolve(request.request.id, true)).toBe(true)
    await expect(promise).resolves.toEqual({ approved: true })
  })

  it('carries a remember scope back through the outcome', async () => {
    const events: AgentEvent[] = []
    const broker = new ApprovalBroker({ emit: (event) => events.push(event) })
    const promise = broker.request('run-1', action('read_file', { path: 'a.txt' }))
    const request = events[0]
    if (request.type !== 'approval:request') throw new Error('unreachable')
    broker.resolve(request.request.id, { approved: true, remember: 'tool' })
    await expect(promise).resolves.toEqual({ approved: true, remember: 'tool' })
  })

  it('records approvals in history, newest first', async () => {
    const events: AgentEvent[] = []
    const broker = new ApprovalBroker({
      emit: (event) => events.push(event),
      now: () => 1000
    })
    const first = broker.request('run-1', action('read_file', {}))
    const second = broker.request('run-1', action('run_command', { command: 'ls' }))
    const requests = events.filter(
      (event): event is Extract<AgentEvent, { type: 'approval:request' }> =>
        event.type === 'approval:request'
    )
    broker.resolve(requests[0].request.id, true)
    broker.resolve(requests[1].request.id, false)
    await first
    await second
    const history = broker.history()
    expect(history).toHaveLength(2)
    expect(history[0]).toMatchObject({ tool: 'run_command', approved: false, at: 1000 })
    expect(history[1]).toMatchObject({ tool: 'read_file', approved: true })
  })

  it('resolves false for an unknown id', () => {
    const broker = new ApprovalBroker({ emit: () => undefined })
    expect(broker.resolve('nope', true)).toBe(false)
  })

  it('fails closed on timeout', async () => {
    const broker = new ApprovalBroker({ emit: () => undefined, timeoutMs: 5 })
    await expect(broker.request('run-1', action('write_file', {}))).resolves.toEqual({
      approved: false
    })
  })

  it('cancelAll denies outstanding requests', async () => {
    const broker = new ApprovalBroker({ emit: () => undefined })
    const promise = broker.request('run-1', action('run_command', { command: 'ls' }))
    expect(broker.pendingCount()).toBe(1)
    broker.cancelAll()
    await expect(promise).resolves.toEqual({ approved: false })
    expect(broker.pendingCount()).toBe(0)
  })

  it('summarizes write and shell actions', () => {
    expect(summarizeAction(action('write_file', { path: 'a.txt', content: 'hi' }))).toContain(
      'Write a.txt'
    )
    expect(summarizeAction(action('run_command', { command: 'ls -la' }))).toBe('Run: ls -la')
  })
})

describe('AgentOrchestrator plan mode + approval gate', () => {
  it('exposes no tools and injects the plan hint in Plan Mode', async () => {
    const manager = createLocalManager(await sandboxDir())
    const adapter = new ScriptedAdapter('deepseek', [{ content: '1. Read the file\n2. Edit it' }])
    const orchestrator = new AgentOrchestrator({
      sandbox: manager,
      providers: [entry(adapter)],
      planMode: true
    })

    const result = await orchestrator.run('improve the parser')

    expect(result.status).toBe('completed')
    expect(result.steps[0].actions).toHaveLength(0)
    const request = adapter.calls[0]
    expect(request.tools).toEqual([])
    expect(request.toolChoice).toBe('none')
    expect(request.messages[0].content).toContain(PLAN_MODE_HINT)
    await manager.dispose()
  })

  it('blocks an action the gate denies, without touching the sandbox', async () => {
    const manager = createLocalManager(await sandboxDir())
    const adapter = new ScriptedAdapter('deepseek', [
      { toolCalls: [toolCall('write_file', { path: 'x.txt', content: 'hi' })] },
      { content: 'ok' }
    ])
    const seen: string[] = []
    const orchestrator = new AgentOrchestrator({
      sandbox: manager,
      providers: [entry(adapter)],
      approvalGate: async (pending) => {
        seen.push(pending.name)
        return false
      }
    })

    const result = await orchestrator.run('write x.txt')

    expect(seen).toEqual(['write_file'])
    expect(result.steps[0].observations[0]).toMatchObject({ ok: false, code: 'blocked' })
    const observation = adapter.calls[1].messages.at(-1)?.content ?? ''
    expect(observation).toContain('not approved')
    await manager.dispose()
  })

  it('runs the action when the gate approves', async () => {
    const dir = await sandboxDir()
    const manager = createLocalManager(dir)
    const adapter = new ScriptedAdapter('deepseek', [
      { toolCalls: [toolCall('write_file', { path: 'y.txt', content: 'hello' })] },
      { content: 'done' }
    ])
    const orchestrator = new AgentOrchestrator({
      sandbox: manager,
      providers: [entry(adapter)],
      approvalGate: async () => true
    })

    const result = await orchestrator.run('write y.txt')

    expect(result.steps[0].observations[0]).toMatchObject({ ok: true, name: 'write_file' })
    await manager.dispose()
  })

  it('reports written files with their previous contents', async () => {
    const dir = await sandboxDir()
    await fs.writeFile(join(dir, 'existing.txt'), 'old', 'utf8')
    const manager = createLocalManager(dir)
    const adapter = new ScriptedAdapter('deepseek', [
      { toolCalls: [toolCall('write_file', { path: 'existing.txt', content: 'new' })] },
      { toolCalls: [toolCall('write_file', { path: 'fresh.txt', content: 'hi' })] },
      { content: 'done' }
    ])
    const changes: Array<{ path: string; before: string; after: string }> = []
    const orchestrator = new AgentOrchestrator({
      sandbox: manager,
      providers: [entry(adapter)],
      sandboxOptions: { workspaceRoot: dir },
      onFileWritten: (change) => changes.push(change)
    })

    await orchestrator.run('edit and create files')

    expect(changes).toEqual([
      { path: 'existing.txt', before: 'old', after: 'new' },
      { path: 'fresh.txt', before: '', after: 'hi' }
    ])
    await manager.dispose()
  })
})
