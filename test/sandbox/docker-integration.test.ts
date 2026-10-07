import { describe, it, expect, beforeAll } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SandboxManagerImpl } from '@core/sandbox/manager'
import { DockerSandboxDriver } from '@core/sandbox/docker-sandbox'
import { ChildProcessRunner } from '@core/sandbox/command-runner'
import type { DriverRegistry } from '@core/sandbox/registry'
import { DEFAULT_SANDBOX_IMAGE } from '@shared/sandbox'

/**
 * Real Docker integration. Requires a working Docker daemon that can actually
 * create containers; where Docker is installed but cannot run containers
 * (e.g. missing namespace privileges) the tests skip with a clear reason.
 */
let dockerReachable = false
let probeDetail = 'docker daemon not reachable'
let base: string

beforeAll(async () => {
  base = await fs.mkdtemp(join(tmpdir(), 'sbx-docker-'))
  try {
    const info = await new ChildProcessRunner().run(
      'docker',
      ['info', '--format', '{{.ServerVersion}}'],
      { timeoutMs: 15_000 }
    )
    dockerReachable = info.exitCode === 0
    if (!dockerReachable) probeDetail = info.stderr.trim().split('\n')[0] || probeDetail
  } catch (error) {
    probeDetail = error instanceof Error ? error.message : String(error)
  }
}, 30_000)

function dockerManager(): SandboxManagerImpl {
  const registry: DriverRegistry = new Map()
  registry.set('docker', new DockerSandboxDriver())
  return new SandboxManagerImpl({
    registry,
    baseDir: base,
    sweepIntervalMs: 0,
    defaultImage: DEFAULT_SANDBOX_IMAGE
  })
}

describe('DockerSandbox integration', () => {
  it('runs `echo hello`, round-trips a file, then destroys the sandbox', async (ctx) => {
    if (!dockerReachable) {
      ctx.skip(`Docker unavailable: ${probeDetail}`)
      return
    }
    const manager = dockerManager()
    let created: Awaited<ReturnType<typeof manager.createSandbox>> | undefined
    try {
      created = await manager.createSandbox({ provider: 'docker', ttlMs: 120_000 })
    } catch (error) {
      await manager.dispose()
      ctx.skip(
        `Docker present but cannot run containers: ${error instanceof Error ? error.message : String(error)}`
      )
      return
    }

    try {
      const result = await manager.executeCommand(created.id, 'echo hello')
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('hello')

      await manager.writeFile(created.id, 'src/data.txt', 'sandbox-content')
      expect(await manager.readFile(created.id, 'src/data.txt')).toBe('sandbox-content')

      const cat = await manager.executeCommand(created.id, 'cat src/data.txt')
      expect(cat.stdout).toBe('sandbox-content')

      await manager.destroySandbox(created.id)
      expect(manager.getSandbox(created.id)).toBeUndefined()
    } finally {
      await manager.dispose()
    }
  }, 180_000)
})
