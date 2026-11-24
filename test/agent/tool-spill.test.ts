import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SandboxToolExecutor, actionFromToolCall } from '@core/agent/tools'
import { toolCall } from '../helpers/fake-adapter'
import { createLocalManager } from '../helpers/local-sandbox-manager'
import type { SandboxManagerImpl } from '@core/sandbox/manager'

/**
 * T13 — output spill.
 *
 * A failing build prints thousands of lines; truncating silently loses the middle, which is usually the part that says
 * why. Past the threshold the whole output goes to `.ai-desktop/artifacts/`, the model gets head + tail + the path, and
 * `read_file` can still reach every byte.
 */
let base: string
let manager: SandboxManagerImpl
let sandboxId: string
let executor: SandboxToolExecutor

function run(command: string) {
  return executor.execute(actionFromToolCall(toolCall('run_command', { command })))
}

beforeEach(async () => {
  base = await fs.mkdtemp(join(tmpdir(), 'agent-spill-'))
  manager = createLocalManager(base)
  sandboxId = (await manager.createSandbox({ provider: 'local' })).id
  executor = new SandboxToolExecutor(manager, sandboxId)
})

afterEach(async () => {
  await manager.dispose()
  await fs.rm(base, { recursive: true, force: true })
})

describe('command output spill (T13)', () => {
  it('leaves a small output alone', async () => {
    const result = await run('echo small-output')

    expect(result.ok).toBe(true)
    expect(result.output).toContain('small-output')
    expect(result.output).not.toContain('.ai-desktop/artifacts')
  })

  it('spills a large output, keeps an excerpt, and makes the whole file readable', async () => {
    const result = await run(`node -e "process.stdout.write('x'.repeat(30000))"`)

    expect(result.ok).toBe(true)
    expect(result.output.length).toBeLessThan(10_000)
    expect(result.output).toContain('.ai-desktop/artifacts/')

    const match = /\.ai-desktop\/artifacts\/cmd-[0-9]+\.log/.exec(result.output)
    expect(match).not.toBeNull()

    const read = await executor.execute(actionFromToolCall(toolCall('read_file', { path: match![0] })))
    expect(read.ok).toBe(true)
    expect(read.output.length).toBe(30_000)
  })
})
