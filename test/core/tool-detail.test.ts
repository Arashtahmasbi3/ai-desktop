import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { AgentToolResult } from '@shared/agent'
import type { ToolResultView } from '@shared/ui'
import { AgentOrchestrator, type ProviderEntry } from '@core/agent-orchestrator'
import { MemoryLogger } from '@core/agent/logger'
import { ScriptedAdapter, toolCall } from '../helpers/fake-adapter'
import { createLocalManager } from '../helpers/local-sandbox-manager'
import { buildToolDetail, capText, TOOL_DETAIL_CAPS } from '@core/agent/tool-detail'

function result(overrides: Partial<AgentToolResult> = {}): AgentToolResult {
  return {
    actionId: 'a1',
    name: 'run_command',
    ok: true,
    output: '',
    attempts: 1,
    durationMs: 12,
    ...overrides
  }
}

describe('P2 buildToolDetail redacts + caps (v2.5.2)', () => {
  it('1. strips secrets from every carried string', () => {
    const view = buildToolDetail(
      result({
        output: 'sk-abcdefghijklmnopqrstuvwxyz012345',
        error: 'auth failed for password=hunter2',
        command: 'curl -H "Authorization: Bearer abcdefghijklmnop"',
        stdout: 'token=ghp_abcdefghijklmnopqrstuvwxyz01',
        stderr: 'api_key=supersecretvalue'
      })
    )
    expect(view.stdout).not.toContain('ghp_')
    expect(view.stderr).not.toContain('supersecretvalue')
    expect(view.command).not.toContain('abcdefghijklmnop')
    expect(view.error).not.toContain('hunter2')
    expect(view.stdout).toContain('[REDACTED]')
  })

  it('2. caps stdout at 10KB with a marker', () => {
    const text = 'x'.repeat(TOOL_DETAIL_CAPS.stdoutBytes + 500)
    const capped = capText(text, TOOL_DETAIL_CAPS.stdoutBytes)
    expect(capped.endsWith('… [truncated]')).toBe(true)
    expect(capped.length).toBeLessThan(text.length)
  })

  it('3. caps stderr at 2KB and stdout at its own budget independently', () => {
    const stdout = 'a'.repeat(TOOL_DETAIL_CAPS.stdoutBytes + 100)
    const stderr = 'b'.repeat(TOOL_DETAIL_CAPS.stderrBytes + 100)
    const view = buildToolDetail(result({ stdout, stderr }))
    expect(view.stdout!.length).toBeLessThan(TOOL_DETAIL_CAPS.stdoutBytes + 20)
    expect(view.stderr!.length).toBeLessThan(TOOL_DETAIL_CAPS.stderrBytes + 20)
  })

  it('4. caps a long stream at 50 lines', () => {
    const many = Array.from({ length: 120 }, (_, index) => `line ${index}`).join('\n')
    const capped = capText(many, 1024 * 1024)
    expect(capped.split('\n').length).toBe(TOOL_DETAIL_CAPS.lines + 1)
    expect(capped).toContain('… [truncated]')
  })

  it('B-19: caps by whole code points, never splitting an emoji surrogate pair', () => {
    const emoji = '🙂' // 4 UTF-8 bytes, 2 UTF-16 units
    const capped = capText(emoji.repeat(100), 7)
    const body = capped.replace(/\n… \[truncated\]$/, '')

    expect(capped.endsWith('… [truncated]')).toBe(true)
    // Byte semantics are unchanged: the kept prefix fits the 7-byte budget...
    expect(Buffer.byteLength(body, 'utf8')).toBeLessThanOrEqual(7)
    // ...and it is a whole number of characters (1 emoji = 4 bytes, 2 would be 8).
    expect(body).toBe(emoji)
    // No lone surrogate survives anywhere in the output.
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(capped)).toBe(false)
    expect(/(?:^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(capped)).toBe(false)
  })

  it('B-19: caps a mixed CJK/emoji stream without splitting a pair', () => {
    // 漢 = 3 bytes, 🙂 = 4 bytes (2 UTF-16 units): a 10-byte cut used to land in
    // the middle of the second emoji.
    const capped = capText(`漢${'🙂'.repeat(50)}`, 10)
    const body = capped.replace(/\n… \[truncated\]$/, '')

    expect(body).toBe('漢🙂') // 7 bytes; adding the next emoji would need 11
    expect(Buffer.byteLength(body, 'utf8')).toBeLessThanOrEqual(10)
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(capped)).toBe(false)
  })
})

describe('P2 orchestrator emits structured tool detail (v2.5.2)', () => {
  let base: string
  beforeEach(async () => {
    base = await fs.mkdtemp(join(tmpdir(), 'tool-detail-'))
  })
  afterEach(async () => {
    await fs.rm(base, { recursive: true, force: true })
  })

  it('5. streams a tool:result view and enriches the action.ok log entry', async () => {
    const manager = createLocalManager(base)
    const adapter = new ScriptedAdapter('deepseek', [
      { toolCalls: [toolCall('run_command', { command: 'echo hi' })] },
      { content: 'Done.' }
    ])
    const logger = new MemoryLogger()
    const views: ToolResultView[] = []
    const orchestrator = new AgentOrchestrator({
      sandbox: manager,
      providers: [{ provider: adapter.provider, adapter, config: { apiKey: 'k', model: 'm' } } as ProviderEntry],
      logger,
      onToolResult: (view) => views.push(view)
    })

    const run = await orchestrator.run('run echo')

    expect(run.status).toBe('completed')
    expect(views).toHaveLength(1)
    const view = views[0]
    expect(view.name).toBe('run_command')
    expect(view.ok).toBe(true)
    expect(view.command).toBe('echo hi')
    expect(view.stdout).toContain('hi')
    expect(view.exitCode).toBe(0)

    const logged = logger.find('action.ok')[0]
    expect(logged.tool).toBe('run_command')
    expect(logged.command).toBe('echo hi')
    expect(logged.exitCode).toBe(0)
  })

  it('6. reports a stop decision when a failing action is not retried', async () => {
    const manager = createLocalManager(base)
    const adapter = new ScriptedAdapter('deepseek', [
      { toolCalls: [toolCall('run_command', { command: 'node -e "process.exit(7)"' })] },
      { content: 'Done.' }
    ])
    const views: ToolResultView[] = []
    const orchestrator = new AgentOrchestrator({
      sandbox: manager,
      providers: [{ provider: adapter.provider, adapter, config: { apiKey: 'k', model: 'm' } } as ProviderEntry],
      logger: new MemoryLogger(),
      onToolResult: (view) => views.push(view)
    })

    await orchestrator.run('fail')

    expect(views).toHaveLength(1)
    expect(views[0].ok).toBe(false)
    expect(views[0].exitCode).toBe(7)
    expect(views[0].recovery).toMatchObject({ decision: 'stop', recovered: false })
  })
})
