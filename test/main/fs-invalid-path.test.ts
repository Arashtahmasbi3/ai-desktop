import { describe, it, expect, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { FileService, PATH_NOT_FOUND, PathNotFoundError } from '../../src/main/file-service'

const created: string[] = []

async function tempDir(): Promise<string> {
  const dir = await fs.mkdtemp(join(tmpdir(), 'ai-desktop-invalid-'))
  created.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(created.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

describe('FileService invalid paths', () => {
  it('throws PATH_NOT_FOUND (not a raw ENOENT crash) for a missing project root', async () => {
    const parent = await tempDir()
    const missing = join(parent, 'does-not-exist', 'nested')
    const service = new FileService()
    service.setRoot(missing)

    const error = await service.list('.').catch((err: unknown) => err)
    expect(error).toBeInstanceOf(PathNotFoundError)
    expect((error as PathNotFoundError).code).toBe(PATH_NOT_FOUND)
    expect((error as Error).message).toMatch(/Path not found/i)
    // The exact OS error must not leak: callers branch on the code, not ENOENT.
    expect((error as { code?: string }).code).not.toBe('ENOENT')
  })

  it('reports rootExists() for valid and missing roots', async () => {
    const dir = await tempDir()
    const service = new FileService()
    service.setRoot(dir)
    expect(service.rootExists()).toBe(true)
    service.setRoot(join(dir, 'gone'))
    expect(service.rootExists()).toBe(false)
    service.setRoot(null)
    expect(service.rootExists()).toBe(false)
  })

  it('throws PATH_NOT_FOUND when a subdirectory disappears', async () => {
    const dir = await tempDir()
    const service = new FileService()
    service.setRoot(dir)
    await fs.mkdir(join(dir, 'sub'))
    await expect(service.list('sub')).resolves.toEqual([])
    await fs.rm(join(dir, 'sub'), { recursive: true })
    await expect(service.list('sub')).rejects.toMatchObject({ code: PATH_NOT_FOUND })
  })

  it('does not throw or crash when listing an empty existing root', async () => {
    const dir = await tempDir()
    const service = new FileService()
    service.setRoot(dir)
    await expect(service.list()).resolves.toEqual([])
  })
})
