import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { isReadOnlyTool } from '@shared/profile'
import { AgentOrchestrator, type ProviderEntry } from '@core/agent-orchestrator'
import { ScriptedAdapter } from '../helpers/fake-adapter'
import { createLocalManager } from '../helpers/local-sandbox-manager'
import type { SandboxManagerImpl } from '@core/sandbox/manager'

function entry(adapter: ScriptedAdapter): ProviderEntry {
  return { provider: adapter.provider, adapter, config: { apiKey: 'k', model: 'm' } }
}

/** The `# Available tools` block of the system prompt, without the static rules. */
function toolsSection(system: string): string {
  return system.match(/# Available tools\n([\s\S]*?)\n\n#/)?.[1] ?? ''
}

let base: string
let manager: SandboxManagerImpl

beforeEach(async () => {
  base = await fs.mkdtemp(join(tmpdir(), 'tool-policy-'))
  manager = createLocalManager(base)
})

afterEach(async () => {
  await manager.dispose()
  await fs.rm(base, { recursive: true, force: true })
})

/**
 * Investigate/read-only is an allowlist: the model is only ever offered tools the
 * profile permits, so a newly added mutating tool cannot leak through (v2.6.2 §5).
 */
describe('AgentOrchestrator toolPolicy', () => {
  it('removes mutating tools from the exposed set', async () => {
    const adapter = new ScriptedAdapter('deepseek', [{ content: 'done' }])
    const orchestrator = new AgentOrchestrator({
      sandbox: manager,
      providers: [entry(adapter)],
      toolPolicy: isReadOnlyTool
    })
    await orchestrator.run('investigate the failure')

    const tools = toolsSection(String(adapter.calls[0].messages[0].content))
    expect(tools).toContain('read_file')
    expect(tools).toContain('list_dir')
    expect(tools).not.toContain('write_file')
    expect(tools).not.toContain('run_command')
  })

  it('offers the full sandbox tool set without a policy', async () => {
    const adapter = new ScriptedAdapter('deepseek', [{ content: 'done' }])
    const orchestrator = new AgentOrchestrator({ sandbox: manager, providers: [entry(adapter)] })
    await orchestrator.run('do the work')

    const tools = toolsSection(String(adapter.calls[0].messages[0].content))
    expect(tools).toContain('write_file')
    expect(tools).toContain('run_command')
    expect(tools).toContain('read_file')
  })

  it('plan-only exposes no tools at all', async () => {
    const adapter = new ScriptedAdapter('deepseek', [{ content: 'a plan' }])
    const orchestrator = new AgentOrchestrator({
      sandbox: manager,
      providers: [entry(adapter)],
      planMode: true
    })
    await orchestrator.run('plan the work')

    const tools = toolsSection(String(adapter.calls[0].messages[0].content))
    expect(tools.trim()).toBe('')
  })
})
