import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { LocalSandboxDriver } from '@core/sandbox/local-sandbox'
import { PathEscapeError } from '@core/sandbox/errors'
import { DEFAULT_SANDBOX_LIMITS } from '@shared/sandbox'

let base: string
let driver: LocalSandboxDriver

beforeEach(async () => {
  base = await fs.mkdtemp(join(tmpdir(), 'sbx-local-'))
  driver = new LocalSandboxDriver()
})

afterEach(async () => {
  await fs.rm(base, { recursive: true, force: true })
})

async function createHandle(extraEnv: Record<string, string> = {}) {
  return driver.create({
    id: 'test',
    workspaceRoot: join(base, 'ws'),
    limits: { ...DEFAULT_SANDBOX_LIMITS },
    networkEnabled: false,
    env: extraEnv
  })
}

describe('LocalSandboxDriver', () => {
  it('creates the workspace directory', async () => {
    const handle = await createHandle()
    const stat = await fs.stat(handle.workspaceRoot)
    expect(stat.isDirectory()).toBe(true)
  })

  it('executes a simple command', async () => {
    const handle = await createHandle()
    const result = await driver.exec(handle, 'echo hello', {})
    expect(result.exitCode).toBe(0)
    expect(result.stdout.trim()).toBe('hello')
  })

  it('writes and reads a file, creating parent directories', async () => {
    const handle = await createHandle()
    await driver.writeFile(handle, 'src/nested/app.js', 'export const x = 1\n')
    const content = await driver.readFile(handle, 'src/nested/app.js')
    expect(content).toBe('export const x = 1\n')

    const onDisk = await fs.readFile(join(handle.workspaceRoot, 'src/nested/app.js'), 'utf8')
    expect(onDisk).toBe('export const x = 1\n')
  })

  it('runs commands in a subdirectory via cwd', async () => {
    const handle = await createHandle()
    await driver.writeFile(handle, 'sub/file.txt', 'here')
    const result = await driver.exec(handle, 'cat file.txt', { cwd: 'sub' })
    expect(result.stdout).toBe('here')
  })

  it('passes environment variables to the command', async () => {
    const handle = await createHandle({ GREETING: 'salam' })
    const result = await driver.exec(handle, 'printf %s "$GREETING"', {})
    expect(result.stdout).toBe('salam')
  })

  it('rejects writes that escape the workspace', async () => {
    const handle = await createHandle()
    await expect(driver.writeFile(handle, '../escape.txt', 'x')).rejects.toBeInstanceOf(
      PathEscapeError
    )
    await expect(driver.readFile(handle, '../../etc/passwd')).rejects.toBeInstanceOf(
      PathEscapeError
    )
  })

  it('honours the command timeout', async () => {
    const handle = await createHandle()
    const result = await driver.exec(handle, 'sleep 5', { timeoutMs: 150 })
    expect(result.timedOut).toBe(true)
  })

  it('destroys the workspace', async () => {
    const handle = await createHandle()
    await driver.destroy(handle)
    await expect(fs.stat(handle.workspaceRoot)).rejects.toThrow()
  })
})
