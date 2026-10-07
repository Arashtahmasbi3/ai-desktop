import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { AgentOrchestrator } from '@core/agent-orchestrator'
import type { ProviderEntry } from '@core/agent-orchestrator'
import { FileSessionStore } from '@core/agent/session-store'
import { FileService } from '../../src/main/file-service'
import { diffLines, summarizeDiff } from '../../src/renderer/src/lib/diff'
import { ScriptedAdapter, toolCall } from '../helpers/fake-adapter'
import { createLocalManager } from '../helpers/local-sandbox-manager'

/**
 * End-to-end flows over the real local sandbox (host child processes) with only
 * the LLM boundary scripted. These assert the whole path: model tool call →
 * sandbox write/exec → real observation → model → persisted artifacts.
 */
let base: string
let projectDir: string
let sessionDir: string

beforeEach(async () => {
  base = await fs.mkdtemp(join(tmpdir(), 'e2e-flow-'))
  projectDir = join(base, 'project')
  sessionDir = join(base, 'sessions')
  await fs.mkdir(projectDir, { recursive: true })
})

afterEach(async () => {
  await fs.rm(base, { recursive: true, force: true })
})

function entry(adapter: ScriptedAdapter): ProviderEntry {
  return { provider: adapter.provider, adapter, config: { apiKey: 'test-key', model: 'test-model' } }
}

describe('E2E: create and run a project in the sandbox', () => {
  it('writes a runnable project, executes it, and feeds the real output back', async () => {
    const manager = createLocalManager(base)
    const adapter = new ScriptedAdapter('deepseek', [
      {
        toolCalls: [
          toolCall('write_file', {
            path: 'index.js',
            content: "console.log('hello from sandbox')"
          })
        ]
      },
      { toolCalls: [toolCall('run_command', { command: 'node index.js' })] },
      { content: 'Ran index.js successfully.' }
    ])
    const orchestrator = new AgentOrchestrator({
      sandbox: manager,
      providers: [entry(adapter)],
      // An explicit workspaceRoot is owned by the caller, so it survives the run.
      sandboxOptions: { workspaceRoot: projectDir }
    })

    const result = await orchestrator.run('create and run a tiny node project')

    expect(result.status).toBe('completed')
    expect(result.finalAnswer).toBe('Ran index.js successfully.')
    expect(result.steps).toHaveLength(3)

    // The artifact is really on disk after the run.
    await expect(fs.readFile(join(projectDir, 'index.js'), 'utf8')).resolves.toContain(
      'hello from sandbox'
    )

    // The command really ran and its stdout was returned as the observation.
    const runStep = result.steps[1]
    expect(runStep.observations[0].ok).toBe(true)
    expect(runStep.observations[0].output).toContain('hello from sandbox')

    // The model received that observation on its final turn.
    expect(JSON.stringify(adapter.calls[2].messages)).toContain('hello from sandbox')

    expect(manager.listSandboxes()).toHaveLength(0)
    await manager.dispose()
  })
})

describe('E2E: file change and diff', () => {
  it('changes a project file through the sandbox and the renderer diff reflects it', async () => {
    const manager = createLocalManager(base)
    const files = new FileService()
    files.setRoot(projectDir)
    await fs.writeFile(
      join(projectDir, 'config.json'),
      '{\n  "version": "1.0.0",\n  "port": 3000\n}\n'
    )
    const before = await files.read('config.json')

    const adapter = new ScriptedAdapter('deepseek', [
      { toolCalls: [toolCall('read_file', { path: 'config.json' })] },
      {
        toolCalls: [
          toolCall('write_file', {
            path: 'config.json',
            content: '{\n  "version": "2.0.0",\n  "port": 8080\n}\n'
          })
        ]
      },
      { content: 'Bumped version and port.' }
    ])
    const orchestrator = new AgentOrchestrator({
      sandbox: manager,
      providers: [entry(adapter)],
      sandboxOptions: { workspaceRoot: projectDir }
    })

    const result = await orchestrator.run('bump the version and port in config.json')

    expect(result.status).toBe('completed')
    expect(result.steps[0].observations[0].output).toContain('"version": "1.0.0"')

    const after = await files.read('config.json')
    expect(after).not.toBe(before)
    expect(after).toContain('2.0.0')
    expect(after).toContain('8080')

    const diff = diffLines(before, after)
    expect(summarizeDiff(diff)).toEqual({ added: 2, removed: 2 })
    expect(diff.filter((line) => line.type === 'add').map((line) => line.text)).toEqual([
      '  "version": "2.0.0",',
      '  "port": 8080'
    ])

    await manager.dispose()
  })
})

describe('E2E: session save and restore', () => {
  it('persists a run and resumes its history in a later run', async () => {
    const manager = createLocalManager(base)
    const store = new FileSessionStore(sessionDir)

    const first = new ScriptedAdapter('deepseek', [{ content: 'Noted the goal.' }])
    const firstRun = new AgentOrchestrator({
      sandbox: manager,
      providers: [entry(first)],
      sessionStore: store,
      sessionId: 'session-e2e'
    })
    const r1 = await firstRun.run('remember the number 42')
    expect(r1.status).toBe('completed')

    const saved = await store.load('session-e2e')
    expect(saved).not.toBeNull()
    expect(saved?.status).toBe('completed')
    expect(
      saved?.messages.some((m) => m.role === 'user' && m.content?.includes('42'))
    ).toBe(true)
    expect(
      saved?.messages.some((m) => m.role === 'assistant' && m.content === 'Noted the goal.')
    ).toBe(true)

    // A brand-new orchestrator (as after an app restart) resumes the transcript.
    const second = new ScriptedAdapter('deepseek', [{ content: 'The number was 42.' }])
    const resumedRun = new AgentOrchestrator({
      sandbox: manager,
      providers: [entry(second)],
      sessionStore: store
    })
    const r2 = await resumedRun.run('what number did I ask you to remember?', {
      resumeSessionId: 'session-e2e'
    })
    expect(r2.status).toBe('completed')
    expect(r2.finalAnswer).toBe('The number was 42.')

    const resumedPrompt = JSON.stringify(second.calls[0].messages)
    expect(resumedPrompt).toContain('remember the number 42')
    expect(resumedPrompt).toContain('Noted the goal.')

    const updated = await store.load('session-e2e')
    expect(updated?.task).toBe('what number did I ask you to remember?')
    expect(updated?.status).toBe('completed')

    await manager.dispose()
  })

  it('lists stored sessions after multiple runs', async () => {
    const manager = createLocalManager(base)
    const store = new FileSessionStore(sessionDir)
    const adapter = new ScriptedAdapter('deepseek', [
      { content: 'one' },
      { content: 'two' }
    ])
    const orchestrator = new AgentOrchestrator({
      sandbox: manager,
      providers: [entry(adapter)],
      sessionStore: store,
      sessionId: 'multi'
    })
    await orchestrator.run('first task')
    await orchestrator.run('second task')

    const sessions = await store.list()
    expect(sessions.map((s) => s.id)).toContain('multi')
    expect(sessions.find((s) => s.id === 'multi')?.status).toBe('completed')

    await manager.dispose()
  })
})
