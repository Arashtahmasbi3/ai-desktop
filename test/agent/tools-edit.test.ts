import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SANDBOX_TOOLS, SandboxToolExecutor, actionFromToolCall } from '@core/agent/tools'
import { toolCall } from '../helpers/fake-adapter'
import { createLocalManager } from '../helpers/local-sandbox-manager'
import type { SandboxManagerImpl } from '@core/sandbox/manager'

/**
 * T01 — the `edit` tool.
 *
 * The interesting cases are the refusals: an edit that cannot find its text, or finds it twice, must change nothing and
 * say why. A tool that guesses is how a one-line change becomes a rewritten file.
 */
let base: string
let manager: SandboxManagerImpl
let sandboxId: string
let executor: SandboxToolExecutor

async function write(path: string, content: string): Promise<void> {
  await executor.execute(actionFromToolCall(toolCall('write_file', { path, content })))
}

async function read(path: string): Promise<string> {
  const result = await executor.execute(actionFromToolCall(toolCall('read_file', { path })))
  return result.output
}

function edit(args: Record<string, unknown>) {
  return executor.execute(actionFromToolCall(toolCall('edit', args)))
}

beforeEach(async () => {
  base = await fs.mkdtemp(join(tmpdir(), 'agent-edit-'))
  manager = createLocalManager(base)
  sandboxId = (await manager.createSandbox({ provider: 'local' })).id
  executor = new SandboxToolExecutor(manager, sandboxId)
})

afterEach(async () => {
  await manager.dispose()
  await fs.rm(base, { recursive: true, force: true })
})

describe('edit (T01)', () => {
  it('is offered with a schema that requires path, old_string and new_string', () => {
    const definition = SANDBOX_TOOLS.find((tool) => tool.name === 'edit')
    expect(definition).toBeDefined()
    expect(definition!.parameters.required).toEqual(['path', 'old_string', 'new_string'])
    expect(definition!.parameters.properties).toHaveProperty('replace_all')
  })

  it('replaces exactly one occurrence and leaves the rest untouched', async () => {
    await write('a.txt', 'line one\nline two\nline three\n')

    const result = await edit({ path: 'a.txt', old_string: 'line two', new_string: 'خط دوم' })

    expect(result.ok).toBe(true)
    expect(await read('a.txt')).toBe('line one\nخط دوم\nline three\n')
  })

  it('refuses when the text is absent, and changes nothing', async () => {
    await write('a.txt', 'hello')

    const result = await edit({ path: 'a.txt', old_string: 'goodbye', new_string: 'x' })

    expect(result.ok).toBe(false)
    expect(result.code).toBe('not_found')
    expect(await read('a.txt')).toBe('hello')
  })

  it('refuses an ambiguous edit instead of picking the first occurrence', async () => {
    await write('a.txt', 'const x = 1\nconst x = 2\n')

    const result = await edit({ path: 'a.txt', old_string: 'const x', new_string: 'let x' })

    expect(result.ok).toBe(false)
    expect(result.code).toBe('invalid_arguments')
    expect(result.error).toContain('2 occurrences')
    expect(await read('a.txt')).toBe('const x = 1\nconst x = 2\n')
  })

  it('replaces every occurrence when replace_all is set', async () => {
    await write('a.txt', 'a b a b a')

    const result = await edit({ path: 'a.txt', old_string: 'a', new_string: 'X', replace_all: true })

    expect(result.ok).toBe(true)
    expect(result.output).toContain('3 occurrences')
    expect(await read('a.txt')).toBe('X b X b X')
  })

  it('treats the replacement as literal text, not as a replacement pattern', async () => {
    await write('a.txt', 'const re = /old/g')

    await edit({ path: 'a.txt', old_string: '/old/g', new_string: '/new/g' })

    // `$&` would be expanded by String.replace; this must survive as typed.
    await edit({ path: 'a.txt', old_string: '/new/g', new_string: 'price: $& 5' })
    expect(await read('a.txt')).toBe('const re = price: $& 5')
  })

  it('refuses an empty old_string', async () => {
    await write('a.txt', 'x')
    const result = await edit({ path: 'a.txt', old_string: '', new_string: 'y' })
    expect(result.ok).toBe(false)
    expect(result.code).toBe('invalid_arguments')
  })

  it('cannot edit outside the workspace', async () => {
    await write('a.txt', 'x')
    const result = await edit({ path: '../escape.txt', old_string: 'x', new_string: 'y' })
    expect(result.ok).toBe(false)
    expect(await fs.readdir(base).then((entries) => entries.includes('escape.txt'))).toBe(false)
  })
})
