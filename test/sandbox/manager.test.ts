import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SandboxManagerImpl } from '@core/sandbox/manager'
import { LocalSandboxDriver } from '@core/sandbox/local-sandbox'
import type { DriverRegistry } from '@core/sandbox/registry'
import { selectProvider, providerPreference } from '@core/sandbox/registry'
import {
  LimitExceededError,
  ProviderUnavailableError,
  SandboxNotFoundError
} from '@core/sandbox/errors'
import type { SandboxProvider } from '@shared/sandbox'
import { FakeDriver } from '../helpers/fake-runner'

let base: string

beforeEach(async () => {
  base = await fs.mkdtemp(join(tmpdir(), 'sbx-mgr-'))
})

afterEach(async () => {
  await fs.rm(base, { recursive: true, force: true })
})

function localRegistry(): DriverRegistry {
  const registry: DriverRegistry = new Map()
  registry.set('local', new LocalSandboxDriver())
  return registry
}

function createManager(overrides: Record<string, unknown> = {}): SandboxManagerImpl {
  return new SandboxManagerImpl({
    registry: localRegistry(),
    baseDir: base,
    sweepIntervalMs: 0,
    ...overrides
  })
}

describe('SandboxManagerImpl — basic operations', () => {
  it('creates a sandbox and reports it', async () => {
    const manager = createManager()
    const info = await manager.createSandbox({ provider: 'local' })

    expect(info.status).toBe('running')
    expect(info.provider).toBe('local')
    expect(info.networkEnabled).toBe(false)
    expect(info.limits.cpus).toBe(1)
    expect(manager.getSandbox(info.id)).toMatchObject({ id: info.id })
    expect(manager.listSandboxes()).toHaveLength(1)

    await fs.stat(info.workspaceRoot!)
    await manager.dispose()
  })

  it('executes a simple command in the sandbox', async () => {
    const manager = createManager()
    const { id } = await manager.createSandbox({ provider: 'local' })

    const result = await manager.executeCommand(id, 'echo hello')
    expect(result.exitCode).toBe(0)
    expect(result.stdout.trim()).toBe('hello')

    await manager.dispose()
  })

  it('writes and reads files in the workspace', async () => {
    const manager = createManager()
    const { id, workspaceRoot } = await manager.createSandbox({ provider: 'local' })

    await manager.writeFile(id, 'notes/todo.md', '# hi\n')
    expect(await manager.readFile(id, 'notes/todo.md')).toBe('# hi\n')
    expect(await fs.readFile(join(workspaceRoot!, 'notes/todo.md'), 'utf8')).toBe('# hi\n')

    await manager.dispose()
  })

  it('auto-removes the workspace on destroy', async () => {
    const manager = createManager()
    const { id, workspaceRoot } = await manager.createSandbox({ provider: 'local' })
    await manager.destroySandbox(id)

    expect(manager.getSandbox(id)).toBeUndefined()
    await expect(fs.stat(workspaceRoot!)).rejects.toThrow()
    await manager.dispose()
  })

  it('throws for unknown sandbox ids', async () => {
    const manager = createManager()
    await expect(manager.executeCommand('nope', 'echo')).rejects.toBeInstanceOf(
      SandboxNotFoundError
    )
    await expect(manager.destroySandbox('nope')).rejects.toBeInstanceOf(SandboxNotFoundError)
    await manager.dispose()
  })

  it('rejects writes that exceed the disk budget', async () => {
    const manager = createManager()
    const { id } = await manager.createSandbox({
      provider: 'local',
      limits: { diskMb: 1 }
    })
    await expect(manager.writeFile(id, 'big.txt', 'x'.repeat(1024 * 1024 + 1))).rejects.toBeInstanceOf(
      LimitExceededError
    )
    await manager.dispose()
  })
})

describe('SandboxManagerImpl — concurrency', () => {
  it('runs commands in several sandboxes in parallel without cross-talk', async () => {
    const manager = createManager({ maxSandboxes: 4 })
    const infos = await Promise.all([
      manager.createSandbox({ provider: 'local' }),
      manager.createSandbox({ provider: 'local' }),
      manager.createSandbox({ provider: 'local' })
    ])

    expect(new Set(infos.map((i) => i.id)).size).toBe(3)
    expect(new Set(infos.map((i) => i.workspaceRoot)).size).toBe(3)

    await Promise.all(
      infos.map((info, index) =>
        manager.writeFile(info.id, 'id.txt', `box-${index}`)
      )
    )
    const results = await Promise.all(
      infos.map((info) => manager.executeCommand(info.id, 'cat id.txt'))
    )
    expect(results.map((r) => r.stdout)).toEqual(['box-0', 'box-1', 'box-2'])

    await manager.dispose()
  })

  it('enforces the max sandbox limit', async () => {
    const manager = createManager({ maxSandboxes: 1, acquireTimeoutMs: 40 })
    await manager.createSandbox({ provider: 'local' })
    await expect(manager.createSandbox({ provider: 'local' })).rejects.toBeInstanceOf(
      LimitExceededError
    )
    await manager.dispose()
  })

  it('releases the slot after destroy', async () => {
    const manager = createManager({ maxSandboxes: 1, acquireTimeoutMs: 40 })
    const first = await manager.createSandbox({ provider: 'local' })
    await manager.destroySandbox(first.id)
    const second = await manager.createSandbox({ provider: 'local' })
    expect(second.status).toBe('running')
    expect(manager.concurrency.inUse).toBe(1)
    await manager.dispose()
  })
})

describe('SandboxManagerImpl — lifecycle / expiry', () => {
  it('sweeps sandboxes past their idle timeout', async () => {
    const manager = createManager()
    const { id } = await manager.createSandbox({ provider: 'local', idleTimeoutMs: 30 })

    await new Promise((resolve) => setTimeout(resolve, 60))
    const swept = await manager.sweep()

    expect(swept).toContain(id)
    expect(manager.getSandbox(id)).toBeUndefined()
    await manager.dispose()
  })

  it('does not sweep fresh sandboxes', async () => {
    const manager = createManager()
    const { id } = await manager.createSandbox({ provider: 'local', idleTimeoutMs: 10_000 })
    expect(await manager.sweep()).toEqual([])
    expect(manager.getSandbox(id)).toBeDefined()
    await manager.dispose()
  })

  it('destroys everything on destroyAll / dispose', async () => {
    const manager = createManager({ maxSandboxes: 4 })
    const infos = await Promise.all([
      manager.createSandbox({ provider: 'local' }),
      manager.createSandbox({ provider: 'local' })
    ])
    await manager.destroyAll()
    expect(manager.listSandboxes()).toHaveLength(0)
    for (const info of infos) {
      await expect(fs.stat(info.workspaceRoot!)).rejects.toThrow()
    }
    await manager.dispose()
  })
})

describe('provider selection', () => {
  it('prefers Docker, then falls back per platform', async () => {
    const registry: DriverRegistry = new Map()
    registry.set('docker', new FakeDriver('docker', false))
    registry.set('local', new FakeDriver('local', true))
    registry.set('windows', new FakeDriver('windows', true))

    expect(providerPreference('win32')).toEqual(['docker', 'windows', 'local'])
    expect(await selectProvider(registry, undefined, 'win32')).toBe('windows')
    expect(await selectProvider(registry, undefined, 'linux')).toBe('local')
  })

  it('uses Docker when the daemon is available', async () => {
    const registry: DriverRegistry = new Map<SandboxProvider, FakeDriver>()
    registry.set('docker', new FakeDriver('docker', true))
    registry.set('local', new FakeDriver('local', true))
    expect(await selectProvider(registry, undefined, 'linux')).toBe('docker')
  })

  it('rejects an explicitly requested provider that is unavailable', async () => {
    const registry: DriverRegistry = new Map<SandboxProvider, FakeDriver>()
    registry.set('docker', new FakeDriver('docker', false))
    await expect(selectProvider(registry, 'docker')).rejects.toBeInstanceOf(
      ProviderUnavailableError
    )
  })

  it('rejects when nothing is available', async () => {
    const registry: DriverRegistry = new Map<SandboxProvider, FakeDriver>()
    registry.set('docker', new FakeDriver('docker', false))
    registry.set('local', new FakeDriver('local', false))
    await expect(selectProvider(registry, undefined, 'linux')).rejects.toBeInstanceOf(
      ProviderUnavailableError
    )
  })

  it('routes manager operations through the selected fallback driver', async () => {
    const fakeWindows = new FakeDriver('windows', true)
    const registry: DriverRegistry = new Map()
    registry.set('docker', new FakeDriver('docker', false))
    registry.set('windows', fakeWindows)
    const manager = new SandboxManagerImpl({
      registry,
      baseDir: base,
      sweepIntervalMs: 0,
      platform: 'win32'
    })

    const info = await manager.createSandbox()
    expect(info.provider).toBe('windows')
    const result = await manager.executeCommand(info.id, 'echo hi')
    expect(result.stdout).toBe('windows:echo hi\n')
    await manager.dispose()
  })
})
