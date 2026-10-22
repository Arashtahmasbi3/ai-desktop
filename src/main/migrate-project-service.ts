import { execFile } from 'node:child_process'
import { statfs } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ReachabilityReport, VpsExecResult } from '@shared/vps'
import type {
  MigrationExecOutcome,
  MigrationJob,
  MigrationPlan,
  MigrationRequest,
  MigrationRun
} from '@shared/migration'
import { DEFAULT_MIGRATION_EXCLUDES } from '@shared/migration'
import type { AuditEntry } from '@core/agent/audit-log'
import { notConnectedMessage, serverNameFor, type ServerNameLookup } from '@core/tools/server-names'
import { validateExcludes } from '@core/tools/migrate-argv'
import {
  preflightMigration,
  type MigrationFlowDeps,
  type MigrationRunOptions
} from '@core/tools/migrate-project-flow'
import { runMigration } from '@core/tools/migrate-project-run'

/**
 * The main-process side of S4: resolve two saved servers into a job, and give `@core` two machines.
 *
 * This is deliberately thin. `@core` decides direct-vs-relay and builds every command; this module
 * only says *where* a command runs:
 *
 *   - the source server, over the app's own SSH session (`SshManager.exec`), so the host policy, the
 *     deny list, the rate limiter and the audit log all still apply;
 *   - this computer, as an **exact argv** through `execFile` — never a shell string, because the
 *     relay runs on Windows as well and a POSIX-quoted command would be a different command there.
 */

export interface MigrationServerConnection {
  host: string
  port: number
  username: string
}

/** The slice of `SshManager` a migration needs. Structural, so tests can fake it. */
export interface MigrationSshHost {
  connectedServers(): string[]
  resolveServer(id: string): Promise<MigrationServerConnection | undefined>
  exec(serverId: string, command: string): Promise<VpsExecResult>
  listServers?(): Promise<Array<{ id: string; name: string }>>
}

export interface MigrationServiceOptions {
  host: MigrationSshHost
  /** Runs one command on this computer, as an exact argv. Injected so tests never spawn. */
  local(argv: readonly string[], signal?: AbortSignal): Promise<MigrationExecOutcome>
  localFreeBytes(): Promise<number | undefined>
  localStagingDir: string
  reachability(target: {
    host: string
    port: number
    sourceServerId: string
  }): Promise<ReachabilityReport>
  audit?(entry: Omit<AuditEntry, 'at'>): Promise<void>
  /** R6: a sentence about a server uses its name, never its id. */
  serverName?: ServerNameLookup
}

export interface ResolvedJob {
  job?: MigrationJob
  error?: string
}

function toOutcome(result: VpsExecResult): MigrationExecOutcome {
  return {
    ok: result.ok,
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
    ...(result.blocked === undefined ? {} : { blocked: result.blocked }),
    ...(result.requiresApproval === undefined ? {} : { requiresApproval: result.requiresApproval }),
    ...(result.rateLimited === undefined ? {} : { rateLimited: result.rateLimited }),
    ...(result.timedOut === undefined ? {} : { timedOut: result.timedOut }),
    ...(result.reason === undefined ? {} : { reason: result.reason })
  }
}

/** The plan a request gets when it cannot even be resolved: one fact, and the reason in it. */
export function refusedPlan(reason: string, excludes: readonly string[]): MigrationPlan {
  return {
    mode: undefined,
    modeReason: reason,
    facts: [{ id: 'session', label: 'Servers', status: 'fail', value: reason }],
    excludes: [...excludes],
    blocked: true,
    estimateBytes: 0,
    stagedBytes: 0,
    resume: false,
    steps: []
  }
}

/**
 * Resolve two ids into a job. A refused source names the server and asks for a session, because a
 * migration needs a *session*, and "not connected" is a different problem from "unknown server".
 */
export async function resolveMigrationJob(
  options: MigrationServiceOptions,
  request: MigrationRequest
): Promise<ResolvedJob> {
  const sourceId = (request.sourceServerId ?? '').trim()
  const targetId = (request.targetServerId ?? '').trim()
  if (sourceId === '') return { error: 'A source server is required.' }
  if (targetId === '') return { error: 'A target server is required.' }
  if (sourceId === targetId) {
    return { error: 'The source and the target are the same server; pick a destination.' }
  }
  if (!options.host.connectedServers().includes(sourceId)) {
    return {
      error: `${await notConnectedMessage(options.serverName, sourceId, 'The source server')} Connect it first.`
    }
  }
  const source = await options.host.resolveServer(sourceId)
  if (source === undefined) return { error: 'Unknown source server.' }
  const target = await options.host.resolveServer(targetId)
  if (target === undefined) return { error: 'Unknown target server.' }

  const sourceName = await serverNameFor(options.serverName, sourceId)
  const targetName = await serverNameFor(options.serverName, targetId)
  return {
    job: {
      source: { serverId: sourceId, ...(sourceName === undefined ? {} : { name: sourceName }), ...source, path: request.sourcePath },
      target: { serverId: targetId, ...(targetName === undefined ? {} : { name: targetName }), ...target, path: request.targetPath },
      excludes: validateExcludes(request.excludes).excludes
    }
  }
}

/** Wire the two machines and the probe into the shape `@core` expects. */
export function createMigrationFlowDeps(
  options: MigrationServiceOptions,
  run: { sourceServerId: string } & MigrationRunOptions
): MigrationFlowDeps {
  return {
    execOnSource: async (command) => toOutcome(await options.host.exec(run.sourceServerId, command)),
    execLocal: async (argv) => options.local(argv, run.signal),
    localStagingDir: options.localStagingDir,
    reachability: (target) => options.reachability(target),
    localFreeBytes: () => options.localFreeBytes(),
    ...(options.audit === undefined ? {} : { audit: options.audit })
  }
}

/** Everything a plan needs, without moving a byte. The form calls this before offering Start. */
export async function preflightMigrationRequest(
  options: MigrationServiceOptions,
  request: MigrationRequest,
  hooks: MigrationRunOptions = {}
): Promise<MigrationPlan> {
  const resolved = await resolveMigrationJob(options, request)
  const excludes = validateExcludes(request.excludes).excludes
  if (resolved.job === undefined) {
    return refusedPlan(resolved.error ?? 'the migration could not be set up', excludes)
  }
  const deps = createMigrationFlowDeps(options, {
    sourceServerId: resolved.job.source.serverId,
    ...hooks
  })
  return preflightMigration(deps, resolved.job, hooks)
}

/* One migration at a time: a second concurrent rsync into the same staging directory is a bug, and
 * the Cancel button must have exactly one thing to stop. */
let active: AbortController | null = null

/** Stop the migration that is running, if any. Returns whether there was one. */
export function cancelActiveMigration(): boolean {
  if (active === null) return false
  active.abort()
  return true
}

/** True while a migration is in flight (the renderer shows Cancel only then). */
export function migrationIsRunning(): boolean {
  return active !== null
}

/**
 * Run a migration, end to end.
 *
 * The abort signal is created here, so `cancelActiveMigration()` stops the transfer itself: main
 * passes it to the local runner (which kills the child) and `@core` checks it before every phase and
 * before the commit, so a cancel can never be followed by a rename.
 */
export async function runMigrationRequest(
  options: MigrationServiceOptions,
  request: MigrationRequest,
  hooks: Pick<MigrationRunOptions, 'onProgress'> = {}
): Promise<MigrationRun> {
  const excludes = validateExcludes(request.excludes).excludes
  const resolved = await resolveMigrationJob(options, request)
  if (resolved.job === undefined) {
    const reason = resolved.error ?? 'the migration could not be set up'
    return {
      ok: false,
      mode: undefined,
      cancelled: false,
      resume: false,
      plan: refusedPlan(reason, excludes),
      log: [],
      message: `Preflight failed, nothing was transferred — ${reason}`
    }
  }

  const controller = new AbortController()
  active = controller
  try {
    const deps = createMigrationFlowDeps(options, {
      sourceServerId: resolved.job.source.serverId,
      signal: controller.signal
    })
    return await runMigration(deps, resolved.job, { ...hooks, signal: controller.signal })
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return {
      ok: false,
      mode: undefined,
      cancelled: controller.signal.aborted,
      resume: controller.signal.aborted,
      plan: refusedPlan(reason, excludes),
      log: [],
      message: `The migration failed: ${reason}`
    }
  } finally {
    if (active === controller) active = null
  }
}

// --- the real local runner --------------------------------------------------

/**
 * Run one exact argv on this computer.
 *
 * `execFile` and not `exec`: there is no shell, so a path with a space or a `;` stays one argument.
 * `timeout: 0` because a 7.9 GB transfer has no business being killed at 30 seconds, and the abort
 * signal is passed through so Cancel reaches the child process.
 */
export function runLocalArgv(
  argv: readonly string[],
  signal?: AbortSignal
): Promise<MigrationExecOutcome> {
  if (argv.length === 0 || argv[0] === undefined || argv[0] === '') {
    return Promise.resolve({
      ok: false,
      stdout: '',
      stderr: 'Blocked: empty command',
      exitCode: 126
    })
  }
  const [file, ...args] = argv
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      {
        windowsHide: true,
        timeout: 0,
        maxBuffer: 8 * 1024 * 1024,
        ...(signal === undefined ? {} : { signal })
      },
      (error, stdout, stderr) => {
        let exitCode = 0
        if (error) {
          const code = (error as { code?: number | string }).code
          exitCode = typeof code === 'number' ? code : (error as { killed?: boolean }).killed ? 143 : 1
        }
        resolve({
          ok: exitCode === 0,
          stdout,
          stderr,
          exitCode,
          ...(signal?.aborted === true ? { timedOut: true } : {})
        })
      }
    )
  })
}

/** Free bytes on the filesystem holding `directory` — the relay needs room for the pulled copy. */
export async function localFreeBytes(directory: string): Promise<number | undefined> {
  try {
    const stats = await statfs(directory)
    const available = Number(stats.bavail) * Number(stats.bsize)
    return Number.isFinite(available) ? available : undefined
  } catch {
    return undefined
  }
}

/** Where the relay keeps its copy before pushing it. One directory per destination, not random. */
export function localStagingDirFor(targetHost: string): string {
  const safe = targetHost.replace(/[^A-Za-z0-9.-]/g, '_')
  return join(tmpdir(), 'ai-desktop-migrate', safe)
}

/** `DEFAULT_MIGRATION_EXCLUDES` re-exported so an IPC layer can seed the form. */
export { DEFAULT_MIGRATION_EXCLUDES }
