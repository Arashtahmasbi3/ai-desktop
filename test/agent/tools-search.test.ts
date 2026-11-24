import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SANDBOX_TOOLS, SandboxToolExecutor, actionFromToolCall, globToRegExp } from '@core/agent/tools'
import { toolCall } from '../helpers/fake-adapter'
import { createLocalManager } from '../helpers/local-sandbox-manager'
import type { SandboxManagerImpl } from '@core/sandbox/manager'

/**
 * T02/T03 — `glob` and `grep`.
 *
 * A code search that walks `node_modules` is a search that times out on a real project, and one that shells out is a
 * search that works on exactly one platform. These tests pin both: the skip list, the caps, the path containment, and a
 * regex that is refused rather than half-applied.
 */
let base: string
let manager: SandboxManagerImpl
let sandboxId: string
let executor: SandboxToolExecutor

async function file(path: string, content: string): Promise<void> {
  const result = await executor.execute(actionFromToolCall(toolCall('write_file', { path, content })))
  expect(result.ok).toBe(true)
}

function run(name: 'glob' | 'grep', args: Record<string, unknown>) {
  return executor.execute(actionFromToolCall(toolCall(name, args)))
}

beforeEach(async () => {
  base = await fs.mkdtemp(join(tmpdir(), 'agent-search-'))
  manager = createLocalManager(base)
  sandboxId = (await manager.createSandbox({ provider: 'local' })).id
  executor = new SandboxToolExecutor(manager, sandboxId)

  await file('src/a.ts', 'export const hello = 1\n')
  await file('src/b.ts', 'export const world = 2\n')
  await file('src/styles.css', '.a { color: red }\n')
  await file('docs/readme.md', '# readme\nhello docs\n')
  await file('nested/deep/c.ts', 'export const deep = 3\n')
  await file('node_modules/pkg/index.js', 'const hello = "vendored"\n')
})

afterEach(async () => {
  await manager.dispose()
  await fs.rm(base, { recursive: true, force: true })
})

describe('globToRegExp (T02)', () => {
  it('lets ** cross separators and keeps * inside one', () => {
    expect(globToRegExp('**/*.ts').test('src/a.ts')).toBe(true)
    expect(globToRegExp('**/*.ts').test('nested/deep/c.ts')).toBe(true)
    expect(globToRegExp('*.ts').test('src/a.ts')).toBe(false)
    expect(globToRegExp('*.ts').test('a.ts')).toBe(true)
    expect(globToRegExp('src/?.ts').test('src/a.ts')).toBe(true)
  })
})

describe('glob (T02)', () => {
  it('finds every TypeScript file, sorted, and never descends into node_modules', async () => {
    const result = await run('glob', { pattern: '**/*.ts' })

    expect(result.ok).toBe(true)
    const lines = result.output.split('\n')
    expect(lines).toEqual(['docs/readme.md', 'src/a.ts'].filter(() => false).concat(['nested/deep/c.ts', 'src/a.ts', 'src/b.ts']))
    expect(result.output).not.toContain('node_modules')
  })

  it('scopes the pattern to the directory it was given', async () => {
    const result = await run('glob', { pattern: '*.ts', path: 'src' })

    expect(result.output.split('\n')).toEqual(['src/a.ts', 'src/b.ts'])
  })

  it('caps the number of results', async () => {
    const result = await run('glob', { pattern: '**/*.ts', max_results: 1 })

    expect(result.output.split('\n')[0]).toBe('nested/deep/c.ts')
    expect(result.output).toContain('2 more')
  })

  it('refuses a path outside the workspace', async () => {
    const result = await run('glob', { pattern: '**/*', path: '../' })
    expect(result.ok).toBe(false)
    expect(result.code).toBe('invalid_arguments')
  })
})

describe('grep (T03)', () => {
  it('returns path, line and text for every match', async () => {
    const result = await run('grep', { pattern: 'hello' })

    expect(result.ok).toBe(true)
    expect(result.output.split('\n')).toEqual([
      'docs/readme.md:2:hello docs',
      'src/a.ts:1:export const hello = 1'
    ])
  })

  it('respects a glob filter', async () => {
    const result = await run('grep', { pattern: 'hello', glob: '**/*.md' })

    expect(result.output.split('\n')).toEqual(['docs/readme.md:2:hello docs'])
  })

  it('does not search vendored directories', async () => {
    const result = await run('grep', { pattern: 'vendored' })

    expect(result.output).toBe('موردی پیدا نشد.')
  })

  it('refuses an invalid regular expression instead of matching nothing', async () => {
    const result = await run('grep', { pattern: '([' })

    expect(result.ok).toBe(false)
    expect(result.code).toBe('invalid_arguments')
    expect(result.error).toContain('regular expression')
  })

  it('caps matches', async () => {
    const result = await run('grep', { pattern: 'export', max_results: 1 })
    expect(result.output.split('\n')).toHaveLength(1)
  })

  it('refuses a path outside the workspace', async () => {
    const result = await run('grep', { pattern: 'x', path: '..' })
    expect(result.ok).toBe(false)
    expect(result.code).toBe('invalid_arguments')
  })
})

describe('the sandbox tool contract (T02/T03)', () => {
  it('offers glob and grep next to the file tools', () => {
    const names = SANDBOX_TOOLS.map((tool) => tool.name)
    expect(names).toEqual([
      'write_file',
      'read_file',
      'edit',
      'glob',
      'grep',
      'create_document',
      'create_spreadsheet',
      'create_presentation',
      'list_dir',
      'run_command'
    ])
  })
})
