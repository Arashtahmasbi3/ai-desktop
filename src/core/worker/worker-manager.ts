import type { AgentRunResult } from '@shared/agent'
import type { CreateSandboxOptions, SandboxManager } from '@shared/sandbox'
import type { WorkerJobRequest, WorkerJobView, WorkerStatus } from '@shared/ui'
import {
  DEFAULT_RESOURCE_LIMITS,
  clampLimits,
  effectiveConcurrency,
  type ResourceLimits
} from './resource-limits'
import { TaskQueue } from './task-queue'

interface WorkerJob extends WorkerJobView {
  command?: string
  task?: string
  controller?: AbortController
}

export interface WorkerManagerOptions {
  sandbox: SandboxManager
  /** Runner for `task` jobs (normally the AgentService). */
  runTask?: (task: string, signal: AbortSignal) => Promise<AgentRunResult>
  limits?: Partial<ResourceLimits>
  onStatus?: (status: WorkerStatus) => void
  sandboxOptions?: CreateSandboxOptions
  now?: () => number
  idFactory?: () => string
}

/**
 * Runs heavy jobs in the background on the main process. Command jobs execute
 * inside a sandbox; task jobs are delegated to the orchestrator (via `runTask`).
 * Concurrency is bounded by the resource limits, and jobs are queued by
 * priority. When offline, queued jobs wait (they are not dropped).
 */
export class WorkerManager {
  private readonly sandbox: SandboxManager
  private readonly runTask?: (task: string, signal: AbortSignal) => Promise<AgentRunResult>
  private readonly limits: ResourceLimits
  private readonly onStatus?: (status: WorkerStatus) => void
  private readonly sandboxOptions: CreateSandboxOptions
  private readonly now: () => number
  private readonly idFactory: () => string

  private readonly queue = new TaskQueue<WorkerJob>()
  private readonly jobs = new Map<string, WorkerJob>()
  private active = 0
  private completed = 0
  private failed = 0
  private online = true
  private stopped = true
  private counter = 0

  constructor(options: WorkerManagerOptions) {
    this.sandbox = options.sandbox
    this.runTask = options.runTask
    this.limits = clampLimits(options.limits ?? {})
    this.onStatus = options.onStatus
    this.sandboxOptions = options.sandboxOptions ?? {}
    this.now = options.now ?? (() => Date.now())
    this.idFactory = options.idFactory ?? (() => `job-${++this.counter}`)
  }

  get concurrency(): number {
    return effectiveConcurrency(this.limits)
  }

  start(): void {
    if (!this.stopped) return
    this.stopped = false
    this.emit()
    this.pump()
  }

  async stop(): Promise<void> {
    this.stopped = true
    for (const job of this.jobs.values()) {
      if (job.status === 'running') job.controller?.abort()
    }
    this.emit()
  }

  setOnline(online: boolean): void {
    if (this.online === online) return
    this.online = online
    this.emit()
    if (online) this.pump()
  }

  getLimits(): ResourceLimits {
    return { ...this.limits }
  }

  /** Submit a job; returns its descriptor immediately. */
  enqueue(request: WorkerJobRequest): WorkerJobView {
    const id = this.idFactory()
    const job: WorkerJob = {
      id,
      label: request.label,
      priority: request.priority ?? 0,
      status: 'queued',
      createdAt: this.now(),
      ...(request.command ? { command: request.command } : {}),
      ...(request.task ? { task: request.task } : {})
    }
    this.jobs.set(id, job)
    this.queue.enqueue(id, job, job.priority)
    this.emit()
    this.pump()
    return this.toView(job)
  }

  cancel(id: string): boolean {
    const job = this.jobs.get(id)
    if (!job) return false
    if (job.status === 'running') {
      job.controller?.abort()
      return true
    }
    if (job.status === 'queued' && this.queue.remove(id)) {
      job.status = 'cancelled'
      job.finishedAt = this.now()
      this.emit()
      return true
    }
    return false
  }

  getStatus(): WorkerStatus {
    const jobs = [...this.jobs.values()]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 50)
      .map((job) => this.toView(job))
    return {
      state: this.active > 0 ? 'running' : this.stopped ? 'stopped' : 'idle',
      active: this.active,
      queued: this.queue.size,
      completed: this.completed,
      failed: this.failed,
      maxConcurrent: this.concurrency,
      memoryMb: this.limits.memoryMb,
      cpuCores: this.limits.cpuCores,
      online: this.online,
      remoteEnabled: false,
      jobs
    }
  }

  private toView(job: WorkerJob): WorkerJobView {
    return {
      id: job.id,
      label: job.label,
      priority: job.priority,
      status: job.status,
      createdAt: job.createdAt,
      ...(job.startedAt !== undefined ? { startedAt: job.startedAt } : {}),
      ...(job.finishedAt !== undefined ? { finishedAt: job.finishedAt } : {}),
      ...(job.error !== undefined ? { error: job.error } : {})
    }
  }

  private emit(): void {
    this.onStatus?.(this.getStatus())
  }

  /** Start as many queued jobs as the concurrency limit allows. */
  private pump(): void {
    if (this.stopped || !this.online) return
    while (this.active < this.concurrency) {
      const item = this.queue.dequeue()
      if (!item) break
      void this.run(item.value)
    }
  }

  private async run(job: WorkerJob): Promise<void> {
    job.status = 'running'
    job.startedAt = this.now()
    job.controller = new AbortController()
    this.active++
    this.emit()

    try {
      await this.execute(job, job.controller.signal)
      job.status = 'completed'
      this.completed++
    } catch (error) {
      if (job.controller.signal.aborted) {
        job.status = 'cancelled'
      } else {
        job.status = 'failed'
        job.error = error instanceof Error ? error.message : String(error)
        this.failed++
      }
    } finally {
      job.finishedAt = this.now()
      delete job.controller
      this.active--
      this.emit()
      this.pump()
    }
  }

  private async execute(job: WorkerJob, signal: AbortSignal): Promise<void> {
    if (job.task) {
      if (!this.runTask) throw new Error('No task runner configured for the worker')
      const result = await this.runTask(job.task, signal)
      if (result.status === 'failed' || result.status === 'aborted') {
        throw new Error(result.message ?? `Agent task ${result.status}`)
      }
      return
    }

    if (!job.command) throw new Error('Job has neither a command nor a task')
    const info = await this.sandbox.createSandbox({ network: { enabled: false }, ...this.sandboxOptions })
    try {
      const result = await this.sandbox.executeCommand(info.id, job.command, {
        timeoutMs: this.limits.jobTimeoutMs
      })
      if (result.exitCode !== 0) {
        throw new Error(`Command exited with code ${result.exitCode}: ${result.stderr}`)
      }
    } finally {
      await this.sandbox.destroySandbox(info.id).catch(() => undefined)
    }
  }

  static defaultLimits(): ResourceLimits {
    return { ...DEFAULT_RESOURCE_LIMITS }
  }
}
