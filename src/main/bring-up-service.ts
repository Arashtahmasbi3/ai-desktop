import type {
  DatabaseJob,
  DatabasePlan,
  DatabaseRequest,
  DatabaseRun
} from '@shared/database-migration'
import type {
  BringUpJob,
  BringUpPlan,
  BringUpProgress,
  BringUpRequest,
  BringUpRun
} from '@shared/bring-up'
import type { MigrationFlowDeps } from '@core/tools/migrate-runner'
import { DEFAULT_REQUIRED_ENV_KEYS, DEFAULT_API_PORT, DEFAULT_WEB_PORT } from '@shared/bring-up'
import type { DatabaseJobCheck } from '@core/tools/db-migrate-argv'
import { validateDatabaseJob } from '@core/tools/db-migrate-argv'
import {
  planDatabaseMigration,
  runDatabaseMigration,
  type DatabaseRunOptions
} from '@core/tools/db-migrate-flow'
import { planBringUp, runBringUp, validateBringUpJob } from '@core/tools/bring-up-flow'
import { notConnectedMessage, serverNameFor } from '@core/tools/server-names'
import {
  createMigrationFlowDeps,
  type MigrationServerConnection,
  type MigrationServiceOptions
} from './migrate-project-service'

/**
 * The main-process side of S5 — the database migration and the target bring-up.
 *
 * Deliberately thin, and deliberately the *same* wiring as S4: `createMigrationFlowDeps` is reused
 * rather than copied, so a `pg_restore` reaches the source through the app's own SSH session (host
 * policy, deny list, rate limiter, audit) and reaches this computer through `execFile(argv)` — one
 * place decides *where* a command runs for all three flows.
 *
 * One run at a time per flow: a second concurrent restore into the same database is a bug, and the
 * Cancel button must have exactly one thing to stop.
 */

export type S5ServiceOptions = Pick<
  MigrationServiceOptions,
  'host' | 'local' | 'localFreeBytes' | 'localStagingDir' | 'reachability' | 'audit' | 'serverName'
>

export interface ResolvedS5Job<T> {
  job?: T
  error?: string
}

/** Both endpoints, resolved from saved ids. Shared by the database and the checklist. */
async function resolveEndpoints(
  options: S5ServiceOptions,
  request: { sourceServerId: string; targetServerId: string }
): Promise<{ source?: MigrationServerConnection & { serverId: string; name?: string }; target?: MigrationServerConnection & { serverId: string; name?: string }; error?: string }> {
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
    source: { serverId: sourceId, ...(sourceName === undefined ? {} : { name: sourceName }), ...source },
    target: { serverId: targetId, ...(targetName === undefined ? {} : { name: targetName }), ...target }
  }
}

/** The project's own name, used to name the two PM2 apps: `/opt/zoonestore` → `zoonestore`. */
function projectNameOf(path: string): string {
  const clean = path.replace(/\/+$/, '')
  const base = clean.slice(clean.lastIndexOf('/') + 1)
  return base === '' ? 'app' : base
}

function checkedReason(checked: DatabaseJobCheck): string {
  return checked.reason ?? 'invalid database parameters'
}

/** A database request → a job, or a sentence saying why not. Nothing is built from a guess. */
export async function resolveDatabaseJob(
  options: S5ServiceOptions,
  request: DatabaseRequest
): Promise<ResolvedS5Job<DatabaseJob>> {
  const endpoints = await resolveEndpoints(options, request)
  if (endpoints.error !== undefined) return { error: endpoints.error }
  const checked = validateDatabaseJob({
    container: request.container,
    database: request.database,
    ...(request.user === undefined ? {} : { user: request.user }),
    ...(request.dumpPath === undefined ? {} : { dumpPath: request.dumpPath }),
    ...(request.sampleTables === undefined ? {} : { sampleTables: request.sampleTables })
  })
  if (!checked.ok) return { error: checkedReason(checked) }
  const source = endpoints.source
  const target = endpoints.target
  if (source === undefined || target === undefined) return { error: 'Unknown server.' }
  /* A database is addressed by container and database name; the endpoint path is unused here. */
  const endpointPath = ''
  return {
    job: {
      source: { ...source, path: endpointPath },
      target: { ...target, path: endpointPath },
      container: checked.container,
      database: checked.database,
      user: checked.user,
      dumpPath: checked.dumpPath,
      sampleTables: checked.sampleTables
    }
  }
}

/** A bring-up request → a job, with the ports, app names and scripts the checklist needs. */
export async function resolveBringUpJob(
  options: S5ServiceOptions,
  request: BringUpRequest
): Promise<ResolvedS5Job<BringUpJob>> {
  const endpoints = await resolveEndpoints(options, request)
  if (endpoints.error !== undefined) return { error: endpoints.error }
  const source = endpoints.source
  const target = endpoints.target
  if (source === undefined || target === undefined) return { error: 'Unknown server.' }

  const projectPath = (request.projectPath ?? '').trim()
  const name = projectNameOf(projectPath)
  const job: BringUpJob = {
    source: { ...source, path: projectPath },
    target: { ...target, path: projectPath },
    projectPath,
    domains: (request.domains ?? []).map((domain) => domain.trim()).filter((domain) => domain !== ''),
    ...(request.certbotEmail === undefined ? {} : { certbotEmail: request.certbotEmail.trim() }),
    requiredEnvKeys: request.requiredEnvKeys ?? [...DEFAULT_REQUIRED_ENV_KEYS],
    apiApp: request.apiApp ?? `${name}-api`,
    webApp: request.webApp ?? `${name}-web`,
    apiPort: request.apiPort ?? DEFAULT_API_PORT,
    webPort: request.webPort ?? DEFAULT_WEB_PORT,
    apiScript: request.apiScript ?? 'start:api',
    webScript: request.webScript ?? 'start:web'
  }
  const problem = validateBringUpJob(job)
  if (problem !== undefined) return { error: problem }
  return { job }
}

function flowDeps(
  options: S5ServiceOptions,
  run: { sourceServerId: string } & DatabaseRunOptions
): MigrationFlowDeps {
  return createMigrationFlowDeps(options, run)
}

/** The plan a request gets when it cannot be resolved: one fact, and the sentence in it. */
function refusedDatabasePlan(reason: string): DatabasePlan {
  return {
    mode: undefined,
    modeReason: reason,
    facts: [{ id: 'session', label: 'Servers', status: 'fail', value: reason }],
    blocked: true,
    dryRun: true,
    estimatedBytes: 0,
    dumpPath: '',
    sampleTables: 0,
    steps: []
  }
}

function refusedBringUpPlan(reason: string): BringUpPlan {
  return {
    mode: 'relay',
    modeReason: reason,
    facts: [{ id: 'session', label: 'Servers', status: 'fail', value: reason }],
    blocked: true,
    steps: []
  }
}

/** The dry run the form calls first. Read-only by construction. */
export async function preflightDatabaseRequest(
  options: S5ServiceOptions,
  request: DatabaseRequest
): Promise<DatabasePlan> {
  const resolved = await resolveDatabaseJob(options, request)
  if (resolved.job === undefined) {
    return refusedDatabasePlan(resolved.error ?? 'the database migration could not be set up')
  }
  return planDatabaseMigration(flowDeps(options, { sourceServerId: resolved.job.source.serverId }), resolved.job)
}

/* One database migration at a time, so Cancel has exactly one thing to stop. */
let activeDatabase: AbortController | null = null
/* One bring-up at a time, for the same reason. */
let activeBringUp: AbortController | null = null

export function cancelActiveDatabaseMigration(): boolean {
  if (activeDatabase === null) return false
  activeDatabase.abort()
  return true
}

export function cancelActiveBringUp(): boolean {
  if (activeBringUp === null) return false
  activeBringUp.abort()
  return true
}

function failedDatabaseRun(reason: string, cancelled: boolean): DatabaseRun {
  const at = Date.now()
  return {
    ok: false,
    mode: undefined,
    cancelled,
    resume: cancelled,
    plan: refusedDatabasePlan(reason),
    results: [],
    log: [],
    message: reason,
    startedAt: at,
    finishedAt: at
  }
}

/** Run the database migration, end to end. The abort signal reaches the local rsync child. */
export async function runDatabaseMigrationRequest(
  options: S5ServiceOptions,
  request: DatabaseRequest,
  hooks: Pick<DatabaseRunOptions, 'onProgress'> = {}
): Promise<DatabaseRun> {
  const resolved = await resolveDatabaseJob(options, request)
  if (resolved.job === undefined) {
    const reason = resolved.error ?? 'the database migration could not be set up'
    return failedDatabaseRun(`Preflight failed, nothing was dumped — ${reason}`, false)
  }
  const controller = new AbortController()
  activeDatabase = controller
  try {
    const deps = flowDeps(options, {
      sourceServerId: resolved.job.source.serverId,
      signal: controller.signal
    })
    return await runDatabaseMigration(deps, resolved.job, { ...hooks, signal: controller.signal })
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return failedDatabaseRun(`The database migration failed: ${reason}`, controller.signal.aborted)
  } finally {
    if (activeDatabase === controller) activeDatabase = null
  }
}

/** The checklist the form shows before it runs anything. */
export async function planBringUpRequest(
  options: S5ServiceOptions,
  request: BringUpRequest
): Promise<BringUpPlan> {
  const resolved = await resolveBringUpJob(options, request)
  if (resolved.job === undefined) {
    return refusedBringUpPlan(resolved.error ?? 'the bring-up could not be set up')
  }
  return planBringUp(flowDeps(options, { sourceServerId: resolved.job.source.serverId }), resolved.job, {
    localStagingDir: options.localStagingDir
  })
}

function failedBringUpRun(reason: string, cancelled: boolean): BringUpRun {
  const at = Date.now()
  return {
    ok: false,
    cancelled,
    resume: cancelled,
    mode: 'relay',
    plan: refusedBringUpPlan(reason),
    results: [],
    log: [],
    message: reason,
    startedAt: at,
    finishedAt: at
  }
}

/** Walk the checklist on the target. Cancel stops it at the next step boundary. */
export async function runBringUpRequest(
  options: S5ServiceOptions,
  request: BringUpRequest,
  hooks: { onProgress?: (event: BringUpProgress) => void } = {}
): Promise<BringUpRun> {
  const resolved = await resolveBringUpJob(options, request)
  if (resolved.job === undefined) {
    const reason = resolved.error ?? 'the bring-up could not be set up'
    return failedBringUpRun(`Preflight failed, nothing was run — ${reason}`, false)
  }
  const controller = new AbortController()
  activeBringUp = controller
  try {
    const deps = flowDeps(options, {
      sourceServerId: resolved.job.source.serverId,
      signal: controller.signal
    })
    return await runBringUp(deps, resolved.job, {
      signal: controller.signal,
      localStagingDir: options.localStagingDir,
      ...(request.completed === undefined ? {} : { completed: request.completed }),
      ...(hooks.onProgress === undefined ? {} : { onProgress: hooks.onProgress })
    })
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return failedBringUpRun(`The bring-up failed: ${reason}`, controller.signal.aborted)
  } finally {
    if (activeBringUp === controller) activeBringUp = null
  }
}
