import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { FileService } from '../../src/main/file-service'

let dir: string
let service: FileService

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'ai-desktop-files-'))
  await fs.mkdir(join(dir, 'src'), { recursive: true })
  await fs.writeFile(join(dir, 'src', 'app.ts'), 'export const x = 1\n')
  await fs.writeFile(join(dir, 'README.md'), '# hi\n')
  service = new FileService()
  service.setRoot(dir)
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe('FileService', () => {
  it('lists directories before files', async () => {
    const entries = await service.list('.')
    expect(entries.map((entry) => entry.name)).toEqual(['src', 'README.md'])
    expect(entries[0].type).toBe('dir')
    expect(entries[1].size).toBeGreaterThan(0)
  })

  it('reads and writes project-relative files', async () => {
    expect(await service.read('src/app.ts')).toContain('export const x')
    await service.write('src/new.ts', 'hello')
    expect(await service.read('src/new.ts')).toBe('hello')
  })

  it('creates files and directories', async () => {
    await service.create('docs', 'dir')
    await service.create('docs/guide.md', 'file')
    const entries = await service.list('docs')
    expect(entries.map((entry) => entry.name)).toEqual(['guide.md'])
  })

  it('refuses to read outside the root', async () => {
    await expect(service.read('../outside.txt')).rejects.toThrow(/escapes/)
  })

  it('refuses to write outside the root', async () => {
    await expect(service.write('../../evil.txt', 'x')).rejects.toThrow(/escapes/)
  })

  it('treats a leading slash as project-relative, never escaping the root', async () => {
    await service.write('/etc/passwd', 'x')
    // Landed inside the project root, not at the real /etc/passwd.
    expect(await service.read('etc/passwd')).toBe('x')
  })

  it('refuses to delete the project root', async () => {
    await expect(service.remove('.')).rejects.toThrow(/project root/)
  })

  it('throws a helpful error when no project is active', async () => {
    const empty = new FileService()
    await expect(empty.list()).rejects.toThrow(/No active project/)
  })

  it('removes files and renames them', async () => {
    await service.rename('README.md', 'README.old.md')
    expect((await service.list('.')).map((entry) => entry.name)).toContain('README.old.md')
    await service.remove('README.old.md')
    expect((await service.list('.')).map((entry) => entry.name)).not.toContain('README.old.md')
  })
})
