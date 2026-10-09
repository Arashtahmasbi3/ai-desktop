import { describe, it, expect } from 'vitest'
import { loadProjectMemory } from '@main/project-memory'

const readFile = (files: Record<string, string>) =>
  (async (path: string) => {
    const name = path.split(/[\\/]/).pop() ?? path
    if (name in files) return files[name]
    const error = new Error('ENOENT') as NodeJS.ErrnoException
    error.code = 'ENOENT'
    throw error
  }) as unknown as (path: string, encoding: 'utf8') => Promise<string | Buffer>

describe('loadProjectMemory', () => {
  it('reads AI_CONTEXT.md and AGENTS.md from the project folder', async () => {
    const block = await loadProjectMemory('/work/app', {
      readFile: readFile({ 'AI_CONTEXT.md': 'Prefer pnpm.', 'AGENTS.md': 'Never touch main.' })
    })
    expect(block).toContain('Prefer pnpm.')
    expect(block).toContain('Never touch main.')
  })

  it('ignores missing files and returns undefined when none exist', async () => {
    expect(await loadProjectMemory('/work/app', { readFile: readFile({}) })).toBeUndefined()
  })
})
