import { promises as fs } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import {
  DEFAULT_SANDBOX_IMAGE,
  DEFAULT_SANDBOX_LIMITS,
  type CreateSandboxOptions,
  type ExecOptions,
  type ExecResult,
  type SandboxInfo,
  type SandboxLimits,
  type SandboxManager,
  type SandboxProvider
} from '@shared/sandbox'
import type { CommandRunner } from './command-runner'
import type { SandboxDriver, SandboxHandle } from './driver'
import { SandboxError, SandboxNotFoundError, SandboxConfigError, LimitExceededError } from './errors'
import { Semaphore } from './concurrency'
import { createDriverRegistry, selectProvider, type DriverRegistry } from './registry'

export interface SandboxManagerOptions {
  registry?: DriverRegistry
  runner?: CommandRunner
  /** Host directory under which per-sandbox workspaces are created. */
  baseDir?: string
  /** Max concurrent live sandboxes (default 4). */
  maxSandboxes?: number
  /** How long `createSandbox` waits for a free slot (default 30s). */
  acquireTimeoutMs?: number
  defaultImage?: string
  defaultLimits?: Partial<SandboxLimits>
  /** Default auto-destroy-after-creation window. */
  defaultTtlMs?: number
  /** Default auto-destroy-after-inactivity window. */
  defaultIdleTimeoutMs?: number
  /** Sweeper interval in ms (0 disables). Default 30s. */
  sweepIntervalMs?: number
  idFactory?: () => string
  now?: () => number
  /** Override the detected platform (used for deterministic provider selection). */
  platform?: NodeJS.Platform
}

interface SandboxRecord {
  info: SandboxInfo
  handle: SandboxHandle
  ttlMs?: number
  idleTimeoutMs?: number
  release: () => void
  ownsWorkspace: boolean
}

const DEFAULT_MAX_SANDBOXES = 4
const DEFAULT_ACQUIRE_TIMEOUT_MS = 30_000
const DEFAULT_SWEEP_INTERVAL_MS = 30_000

/**
 * Owns the sandbox lifecycle: provider selection, creation, per-command
 * execution, file transfer, concurrency limits and TTL/idle auto-destruction.
 */
export class SandboxManagerImpl implements SandboxManager {
  private readonly registry: DriverRegistry
  private readonly records = new Map<string, SandboxRecord>()
  private readonly semaphore: Semaphore
  private readonly baseDir: string
  private readonly acquireTimeoutMs: number
  private readonly defaultImage: string
  private readonly defaultLimits: SandboxLimits
  private readonly defaultTtlMs?: number
  private readonly defaultIdleTimeoutMs?: number
  private readonly idFactory: () => string
  private readonly now: () => number
  private readonly platform: NodeJS.Platform
  private readonly sweepTimer?: ReturnType<typeof setInterval>
  private disposed = false

  constructor(options: SandboxManagerOptions = {}) {
    this.registry =
      options.registry ?? createDriverRegistry({ runner: options.runner })
    this.baseDir = resolve(options.baseDir ?? join(tmpdir(), 'ai-desktop-sandboxes'))
    this.acquireTimeoutMs = options.acquireTimeoutMs ?? DEFAULT_ACQUIRE_TIMEOUT_MS
    this.defaultImage = options.defaultImage ?? DEFAULT_SANDBOX_IMAGE
    this.defaultLimits = { ...DEFAULT_SANDBOX_LIMITS, ...options.defaultLimits }
    this.defaultTtlMs = options.defaultTtlMs
    this.defaultIdleTimeoutMs = options.defaultIdleTimeoutMs
    this.idFactory = options.idFactory ?? (() => randomUUID())
    this.now = options.now ?? (() => Date.now())
    this.platform = options.platform ?? process.platform

    this.semaphore = new Semaphore(options.maxSandboxes ?? DEFAULT_MAX_SANDBOXES)
    const sweepIntervalMs = options.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS
    if (sweepIntervalMs > 0) {
      this.sweepTimer = setInterval(() => {
        void this.sweep().catch(() => undefined)
      }, sweepIntervalMs)
      this.sweepTimer.unref?.()
    }
  }

  get concurrency(): { limit: number; inUse: number; pending: number } {
    return {
      limit: this.semaphore.limit,
      inUse: this.semaphore.inUse,
      pending: this.semaphore.pending
    }
  }

  async createSandbox(options: CreateSandboxOptions = {}): Promise<SandboxInfo> {
    this.assertNotDisposed()
    const release = await this.acquireOrThrow()
    const id = this.idFactory()
    const ownsWorkspace = !options.workspaceRoot
    const workspaceRoot = options.workspaceRoot ?? join(this.baseDir, id)

    try {
      const provider = await this.resolveProvider(options.provider)
      const driver = this.requireDriver(provider)
      await fs.mkdir(this.baseDir, { recursive: true }).catch(() => undefined)

      const limits: SandboxLimits = { ...this.defaultLimits, ...options.limits }
      const networkEnabled = options.network?.enabled ?? false
      const env = options.env ?? {}
      const ttlMs = options.ttlMs ?? this.defaultTtlMs
      const idleTimeoutMs = options.idleTimeoutMs ?? this.defaultIdleTimeoutMs

      const handle = await driver.create({
        ...options,
        id,
        image: options.image ?? this.defaultImage,
        workspaceRoot,
        limits,
        networkEnabled,
        env
      })
      handle.ownsWorkspace = ownsWorkspace

      const timestamp = this.now()
      const info: SandboxInfo = {
        id,
        provider,
        status: 'running',
        image: handle.image,
        createdAt: timestamp,
        lastUsedAt: timestamp,
        workspaceRoot,
        limits,
        networkEnabled
      }

      const record: SandboxRecord = {
        info,
        handle,
        ttlMs,
        idleTimeoutMs,
        release,
        ownsWorkspace
      }
      this.records.set(id, record)
      return { ...info, limits: { ...limits } }
    } catch (error) {
      release()
      if (ownsWorkspace) {
        await fs.rm(workspaceRoot, { recursive: true, force: true }).catch(() => undefined)
      }
      throw error
    }
  }

  async executeCommand(
    sandboxId: string,
    command: string,
    options: ExecOptions = {}
  ): Promise<ExecResult> {
    const record = this.requireRecord(sandboxId)
    if (typeof command !== 'string' || command.trim() === '') {
      throw new SandboxConfigError('command must be a non-empty string')
    }
    const timeoutMs = this.effectiveTimeout(record, options.timeoutMs)
    record.info.lastUsedAt = this.now()
    const driver = this.requireDriver(record.info.provider)
    return driver.exec(record.handle, command, { ...options, timeoutMs })
  }

  async writeFile(
    sandboxId: string,
    path: string,
    content: string | Uint8Array
  ): Promise<void> {
    const record = this.requireRecord(sandboxId)
    const size = typeof content === 'string' ? Buffer.byteLength(content) : content.byteLength
    const budget = record.info.limits.diskMb * 1024 * 1024
    if (size > budget) {
      throw new LimitExceededError(
        `write of ${size} bytes exceeds the ${record.info.limits.diskMb} MiB workspace budget`
      )
    }
    record.info.lastUsedAt = this.now()
    const driver = this.requireDriver(record.info.provider)
    await driver.writeFile(record.handle, path, content)
  }

  async readFile(sandboxId: string, path: string): Promise<string> {
    const record = this.requireRecord(sandboxId)
    record.info.lastUsedAt = this.now()
    const driver = this.requireDriver(record.info.provider)
    return driver.readFile(record.handle, path)
  }

  async destroySandbox(sandboxId: string): Promise<void> {
    const record = this.requireRecord(sandboxId)
    this.records.delete(sandboxId)
    await this.teardown(record)
  }

  getSandbox(sandboxId: string): SandboxInfo | undefined {
    const record = this.records.get(sandboxId)
    return record ? { ...record.info, limits: { ...record.info.limits } } : undefined
  }

  listSandboxes(): SandboxInfo[] {
    return [...this.records.values()].map((record) => ({
      ...record.info,
      limits: { ...record.info.limits }
    }))
  }

  async destroyAll(): Promise<void> {
    const ids = [...this.records.keys()]
    await Promise.allSettled(ids.map((id) => this.destroySandbox(id)))
  }

  async sweep(): Promise<string[]> {
    const timestamp = this.now()
    const expired: string[] = []
    for (const record of this.records.values()) {
      const pastTtl =
        record.ttlMs !== undefined && timestamp - record.info.createdAt >= record.ttlMs
      const pastIdle =
        record.idleTimeoutMs !== undefined &&
        timestamp - record.info.lastUsedAt >= record.idleTimeoutMs
      if (pastTtl || pastIdle) expired.push(record.info.id)
    }
    await Promise.allSettled(expired.map((id) => this.destroySandbox(id)))
    return expired
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    if (this.sweepTimer) clearInterval(this.sweepTimer)
    await this.destroyAll()
  }

  private async teardown(record: SandboxRecord): Promise<void> {
    record.info.status = 'stopped'
    const driver = this.registry.get(record.info.provider)
    try {
      await driver?.destroy(record.handle)
    } finally {
      if (record.ownsWorkspace) {
        await fs
          .rm(record.handle.workspaceRoot, { recursive: true, force: true })
          .catch(() => undefined)
      }
      record.release()
    }
  }

  private effectiveTimeout(record: SandboxRecord, requested?: number): number | undefined {
    const base = requested ?? 30_000
    if (record.ttlMs === undefined) return base
    const remaining = record.ttlMs - (this.now() - record.info.createdAt)
    if (remaining <= 0) {
      throw new SandboxError('sandbox has expired', 'destroyed', { sandboxId: record.info.id })
    }
    return Math.min(base, remaining)
  }

  private async resolveProvider(preferred?: SandboxProvider): Promise<SandboxProvider> {
    return selectProvider(this.registry, preferred, this.platform)
  }

  private requireDriver(provider: SandboxProvider): SandboxDriver {
    const driver = this.registry.get(provider)
    if (!driver) throw new SandboxConfigError(`no driver registered for provider "${provider}"`)
    return driver
  }

  private requireRecord(id: string): SandboxRecord {
    const record = this.records.get(id)
    if (!record) throw new SandboxNotFoundError(id)
    return record
  }

  private async acquireOrThrow(): Promise<() => void> {
    return this.semaphore.acquire(this.acquireTimeoutMs)
  }

  private assertNotDisposed(): void {
    if (this.disposed) throw new SandboxError('sandbox manager has been disposed', 'destroyed')
  }
}
