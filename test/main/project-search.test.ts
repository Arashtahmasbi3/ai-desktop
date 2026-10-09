import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { searchProject } from '../../src/main/project-search'

let root: string

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'search-'))
  await fs.mkdir(join(root, 'src'), { recursive: true })
  await fs.mkdir(join(root, 'node_modules', 'dep'), { recursive: true })
  await fs.writeFile(join(root, 'src', 'a.ts'), 'const foo = 1\n// TODO: fix foo\n', 'utf8')
  await fs.writeFile(join(root, 'README.md'), 'Nothing to see here\n', 'utf8')
  await fs.writeFile(join(root, 'node_modules', 'dep', 'index.js'), 'foo foo foo\n', 'utf8')
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe('searchProject', () => {
  it('returns line-tagged matches and skips dependency directories', async () => {
    const matches = await searchProject(root, 'foo')
    expect(matches).toEqual([
      { path: 'src/a.ts', line: 1, text: 'const foo = 1' },
      { path: 'src/a.ts', line: 2, text: '// TODO: fix foo' }
    ])
  })

  it('is case-insensitive by default and empty for blank queries', async () => {
    await expect(searchProject(root, 'NOTHING')).resolves.toEqual([
      { path: 'README.md', line: 1, text: 'Nothing to see here' }
    ])
    await expect(searchProject(root, '   ')).resolves.toEqual([])
  })
})
