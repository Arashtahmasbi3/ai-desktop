import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  SANDBOX_TOOLS,
  SandboxToolExecutor,
  actionFromToolCall,
  stableStringify
} from '@core/agent/tools'
import { rawToolCall, toolCall } from '../helpers/fake-adapter'
import { createLocalManager } from '../helpers/local-sandbox-manager'
import type { SandboxManagerImpl } from '@core/sandbox/manager'

let base: string
let manager: SandboxManagerImpl
let sandboxId: string
let executor: SandboxToolExecutor

beforeEach(async () => {
  base = await fs.mkdtemp(join(tmpdir(), 'agent-tools-'))
  manager = createLocalManager(base)
  sandboxId = (await manager.createSandbox({ provider: 'local' })).id
  executor = new SandboxToolExecutor(manager, sandboxId)
})

afterEach(async () => {
  await manager.dispose()
  await fs.rm(base, { recursive: true, force: true })
})

describe('stableStringify / actionFromToolCall', () => {
  it('produces a stable signature regardless of key order', () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe(stableStringify({ a: 2, b: 1 }))
  })

  it('parses valid tool-call arguments', () => {
    const action = actionFromToolCall(toolCall('write_file', { path: 'a.txt', content: 'x' }))
    expect(action.valid).toBe(true)
    expect(action.arguments).toEqual({ path: 'a.txt', content: 'x' })
    expect(action.signature).toBe('write_file:{"content":"x","path":"a.txt"}')
  })

  it('marks malformed JSON as invalid', () => {
    const action = actionFromToolCall(rawToolCall('write_file', '{not json'))
    expect(action.valid).toBe(false)
    expect(action.signature).toContain('raw:')
  })

  it('exposes the four sandbox tools', () => {
    expect(SANDBOX_TOOLS.map((tool) => tool.name)).toEqual([
      'write_file',
      'read_file',
      'list_dir',
      'run_command'
    ])
  })
})

describe('SandboxToolExecutor', () => {
  it('writes then reads a file through the sandbox', async () => {
    const write = await executor.execute(
      actionFromToolCall(toolCall('write_file', { path: 'notes/todo.md', content: 'hello' }))
    )
    expect(write.ok).toBe(true)

    const read = await executor.execute(
      actionFromToolCall(toolCall('read_file', { path: 'notes/todo.md' }))
    )
    expect(read.ok).toBe(true)
    expect(read.output).toBe('hello')
  })

  it('runs a command and reports its output', async () => {
    const result = await executor.execute(
      actionFromToolCall(toolCall('run_command', { command: 'echo agent-ok' }))
    )
    expect(result.ok).toBe(true)
    expect(result.output).toContain('agent-ok')
  })

  it('lists the workspace directory', async () => {
    await manager.writeFile(sandboxId, 'listed.txt', 'x')
    const result = await executor.execute(actionFromToolCall(toolCall('list_dir', { path: '.' })))
    expect(result.ok).toBe(true)
    expect(result.output).toContain('listed.txt')
  })

  it('reports a non-zero exit code as exit_nonzero', async () => {
    const result = await executor.execute(
      actionFromToolCall(toolCall('run_command', { command: 'exit 3' }))
    )
    expect(result.ok).toBe(false)
    expect(result.code).toBe('exit_nonzero')
  })

  it('rejects unknown tools', async () => {
    const result = await executor.execute(actionFromToolCall(toolCall('rm_rf', { path: '/' })))
    expect(result.ok).toBe(false)
    expect(result.code).toBe('unknown_tool')
  })

  it('rejects malformed arguments', async () => {
    const result = await executor.execute(actionFromToolCall(rawToolCall('write_file', '{bad')))
    expect(result.ok).toBe(false)
    expect(result.code).toBe('invalid_arguments')
  })

  it('rejects missing required arguments', async () => {
    const result = await executor.execute(
      actionFromToolCall(toolCall('write_file', { path: 'a.txt' }))
    )
    expect(result.ok).toBe(false)
    expect(result.code).toBe('invalid_arguments')
  })

  it('refuses writes that escape the workspace', async () => {
    const result = await executor.execute(
      actionFromToolCall(toolCall('write_file', { path: '../escape.txt', content: 'x' }))
    )
    expect(result.ok).toBe(false)
    expect(result.code).toBe('sandbox_error')
  })
})
