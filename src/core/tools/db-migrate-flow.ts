/**
 * The database migration flow — S5.1, and half of S5.3.
 *
 * One function decides the mode, one builds the plan (the dry run), one runs it. It sits **on top of
 * the flow S4 landed** rather than beside it: the mode comes from the same `chooseMode` over the same
 * three-path reachability report, and every command reaches a machine through the same
 * `onSource` / `onTarget` / `onRunner` helpers, so the host policy, deny list, rate limiter and audit
 * log apply to a `pg_restore` exactly as they apply to an `rsync`.
 *
 * Three decisions worth stating:
 *
 * 1. **The dump is the unit of resumability, and its sha256 is the proof.** A run cancelled after the
 *    transfer leaves the dump on the target; the next run reads its digest, sees it is the same file,
 *    and skips the copy. Nothing is trusted by name or by size.
 * 2. **The comparison is the gate.** `pg_restore` can exit non-zero on a warning while restoring
 *    everything, and it can exit zero while restoring nothing. So the exit code is *recorded* and the
 *    table count plus the sampled row counts decide — a partial restore cannot pass.
 * 3. **A dry run writes nothing.** The estimate is `pg_database_size`, a catalog read; the container
 *    probe is `docker inspect`; the baseline is a `count(*)`. The commands that create a directory, a
 *    dump, a database or a restore exist in the plan and are not executed.
 */
import type { ReachabilityReport } from '@shared/vps'
import type {
  DatabaseBaseline,
  DatabaseJob,
  DatabasePlan,
  DatabaseRun,
  DatabaseStep,
  DatabaseStepId,
  DatabaseStepResult,
  DatabaseVerification
} from '@shared/database-migration'
import type { MigrationExecOutcome, MigrationProgress } from '@shared/migration'
import { bareHost } from '@shared/host-address'
import { formatBytes } from './migrate-project-tool'
import { chooseMode } from './migrate-project-flow'
import { formatArgv } from './migrate-argv'
import {
  buildContainerProbeCommand,
  buildDatabaseBaselineCommand,
  buildDatabaseEstimateCommand,
  buildDumpCommand,
  buildDumpDigestCommand,
  buildExistingDigestCommand,
  buildFileRsyncArgv,
  buildPrepareDatabaseCommand,
  buildPrepareDirCommand,
  buildRestoreCommand,
  localDumpDirFor,
  parseContainerRunning,
  parseDatabaseBaseline,
  parseDigestAndBytes,
  parseNumberOutput,
  validateDatabaseJob,
  type DatabaseTarget
} from './db-migrate-argv'
import {
  Progress,
  firstLine,
  onRunner,
  onSource,
  onTarget,
  sourceLabelFor,
  targetLabelFor,
  type Ctx,
  type MigrationFlowDeps
} from './migrate-runner'

export interface DatabaseRunOptions {
  signal?: AbortSignal | undefined
  onProgress?: ((event: MigrationProgress) => void) | undefined
  /** Injected so a test never reads the wall clock. */
  now?: (() => number) | undefined
  dryRun?: boolean | undefined
}

type Ladder = Pick<MigrationFlowDeps, 'localStagingDir'>

function dumpName(dumpPath: string): string {
  return dumpPath.slice(dumpPath.lastIndexOf('/') + 1)
}

function endpointOf(job: DatabaseJob): DatabaseTarget {
  return { container: job.container, database: job.database, user: job.user }
}

function label(job: DatabaseJob): string {
  return `${job.container}/${job.database}`
}

function localDumpPath(deps: Ladder, job: DatabaseJob): string {
  return `${localDumpDirFor(deps.localStagingDir)}${dumpName(job.dumpPath)}`
}

function remote(
  server: { username: string; host: string; port: number },
  path: string
): { username: string; host: string; port: number; path: string } {
  return { username: server.username, host: server.host, port: server.port, path }
}

/** The transfer argv for one leg: the only steps whose runner needs an exact argv. */
function transferArgv(deps: Ladder, job: DatabaseJob, id: 'transfer' | 'pull' | 'push'): string[] {
  if (id === 'transfer') {
    return buildFileRsyncArgv({ from: job.dumpPath, to: remote(job.target, job.dumpPath) })
  }
  if (id === 'pull') {
    return buildFileRsyncArgv({
      from: remote(job.source, job.dumpPath),
      to: localDumpDirFor(deps.localStagingDir)
    })
  }
  return buildFileRsyncArgv({ from: localDumpPath(deps, job), to: remote(job.target, job.dumpPath) })
}

/** Every way the two baselines disagree, as sentences a user can act on. */
export function compareDatabaseBaselines(
  source: DatabaseBaseline,
  target: DatabaseBaseline
): string[] {
  const problems: string[] = []
  if (source.tables !== target.tables) {
    problems.push(`table count ${source.tables} on the source but ${target.tables} on the target`)
  }
  const targetRows = new Map(target.sample.map((entry) => [entry.table, entry.rows]))
  const sourceRows = new Map(source.sample.map((entry) => [entry.table, entry.rows]))
  for (const entry of source.sample) {
    const rows = targetRows.get(entry.table)
    if (rows === undefined) {
      problems.push(`table "${entry.table}" is on the source but not in the target's sample`)
    } else if (rows !== entry.rows) {
      problems.push(
        `table "${entry.table}" has ${entry.rows} rows on the source but ${rows} on the target`
      )
    }
  }
  for (const entry of target.sample) {
    if (!sourceRows.has(entry.table)) {
      problems.push(`table "${entry.table}" is on the target but not in the source's sample`)
    }
  }
  return problems
}

/** The plan as commands. Pure: no machine, no clock, no network. */
export function buildDatabaseSteps(
  job: DatabaseJob,
  mode: 'direct' | 'relay',
  deps: Ladder
): DatabaseStep[] {
  const runner = mode === 'direct' ? 'source' : 'local'
  const endpoint = endpointOf(job)
  const sourceName = sourceLabelFor(job)
  const targetName = targetLabelFor(job)
  const dumpDir = job.dumpPath.replace(/\/[^/]+$/, '')
  const steps: DatabaseStep[] = [
    {
      id: 'container-source',
      title: 'Container on the source',
      runner: 'source',
      where: 'source',
      command: buildContainerProbeCommand(job.container),
      expect: `${job.container} reports running=true on ${sourceName}`
    },
    {
      id: 'container-target',
      title: 'Container on the target',
      runner,
      where: 'target',
      command: buildContainerProbeCommand(job.container),
      expect: `${job.container} reports running=true on ${targetName}`
    },
    {
      id: 'estimate',
      title: 'Estimated size',
      runner: 'source',
      where: 'source',
      command: buildDatabaseEstimateCommand(endpoint),
      expect: 'a byte count from pg_database_size (a catalog read, writes nothing)'
    },
    {
      id: 'baseline-source',
      title: 'Baseline on the source',
      runner: 'source',
      where: 'source',
      command: buildDatabaseBaselineCommand(endpoint, job.sampleTables),
      expect: `a table count and the exact row counts of ${job.sampleTables} sampled tables`
    },
    {
      id: 'prepare-source',
      title: 'Dump directory on the source',
      runner: 'source',
      where: 'source',
      command: buildPrepareDirCommand(job.dumpPath),
      expect: `the directory ${dumpDir} exists on ${sourceName}`
    },
    {
      id: 'dump',
      title: 'Dump on the source',
      runner: 'source',
      where: 'source',
      command: buildDumpCommand(endpoint, job.dumpPath),
      expect: `the custom-format dump exists at ${job.dumpPath} on ${sourceName}`
    },
    {
      id: 'digest-source',
      title: 'Digest of the dump',
      runner: 'source',
      where: 'source',
      command: buildDumpDigestCommand(job.dumpPath),
      expect: 'a sha256 and a byte count for the dump'
    },
    {
      id: 'prepare-target',
      title: 'Dump directory on the target',
      runner,
      where: 'target',
      command: buildPrepareDirCommand(job.dumpPath),
      expect: `the directory ${dumpDir} exists on ${targetName}`
    },
    {
      id: 'digest-existing',
      title: 'Is this dump already on the target?',
      runner,
      where: 'target',
      command: buildExistingDigestCommand(job.dumpPath),
      expect: '"none" for a fresh run, or the same sha256 as the source — that is a resume'
    }
  ]
  if (mode === 'direct') {
    steps.push({
      id: 'transfer',
      title: 'Transfer the dump',
      runner: 'source',
      where: 'target',
      command: formatArgv(transferArgv(deps, job, 'transfer')),
      expect: `the dump is at ${job.dumpPath} on ${targetName}`
    })
  } else {
    steps.push(
      {
        id: 'pull',
        title: 'Pull the dump to this computer',
        runner: 'local',
        where: 'source',
        command: formatArgv(transferArgv(deps, job, 'pull')),
        expect: `the dump is in ${localDumpDirFor(deps.localStagingDir)}`
      },
      {
        id: 'push',
        title: 'Push the dump to the target',
        runner: 'local',
        where: 'target',
        command: formatArgv(transferArgv(deps, job, 'push')),
        expect: `the dump is at ${job.dumpPath} on ${targetName}`
      }
    )
  }
  steps.push(
    {
      id: 'digest-target',
      title: 'Digest on the target',
      runner,
      where: 'target',
      command: buildDumpDigestCommand(job.dumpPath),
      expect: 'the same sha256 as the dump taken on the source'
    },
    {
      id: 'prepare-database',
      title: 'Database on the target',
      runner,
      where: 'target',
      command: buildPrepareDatabaseCommand(endpoint),
      expect: `the database ${job.database} exists on ${targetName} (created when missing)`
    },
    {
      id: 'restore',
      title: 'Restore the dump',
      runner,
      where: 'target',
      command: buildRestoreCommand(endpoint, job.dumpPath),
      expect: 'pg_restore reads the dump on the target and exits 0 — the comparison decides'
    },
    {
      id: 'baseline-target',
      title: 'Baseline on the target',
      runner,
      where: 'target',
      command: buildDatabaseBaselineCommand(endpoint, job.sampleTables),
      expect: 'the same table count and the same row counts as the source'
    }
  )
  return steps
}

/**
 * Everything the user is shown before anything is written.
 *
 * Read-only by construction: `docker inspect`, `pg_database_size` and a `count(*)` per sampled table.
 * The plan's mutating commands are built and printed, never run.
 */
async function preflightDatabase(
  deps: MigrationFlowDeps,
  job: DatabaseJob,
  progress: Progress
): Promise<DatabasePlan> {
  const checked = validateDatabaseJob(job)
  const base: DatabasePlan = {
    mode: undefined,
    modeReason: '',
    facts: [],
    blocked: true,
    dryRun: true,
    estimatedBytes: 0,
    dumpPath: job.dumpPath,
    sampleTables: job.sampleTables,
    steps: []
  }
  progress.tick('preflight', `${label(job)} → ${targetLabelFor(job)}`)
  if (!checked.ok) {
    const reason = checked.reason ?? 'invalid parameters'
    return {
      ...base,
      modeReason: `the plan cannot be built — ${reason}`,
      facts: [{ id: 'params', label: 'Parameters', status: 'fail', value: reason }]
    }
  }
  const safeJob: DatabaseJob = { ...job, user: checked.user, dumpPath: checked.dumpPath }
  const sourceName = sourceLabelFor(safeJob)
  const targetName = targetLabelFor(safeJob)

  let report: ReachabilityReport | undefined
  try {
    report = await deps.reachability({
      host: bareHost(job.target.host),
      port: job.target.port,
      sourceServerId: job.source.serverId
    })
  } catch {
    report = undefined
  }
  const decision =
    report === undefined
      ? {
          mode: undefined,
          blocked: true,
          reason: 'the reachability probe could not run, so the safe mode is unknown'
        }
      : chooseMode(report)
  const facts: DatabasePlan['facts'] = [
    {
      id: 'reachability',
      label: 'Path to the target',
      status: decision.blocked ? 'fail' : 'pass',
      value: decision.reason,
      ...(report === undefined ? {} : { detail: report.summary })
    }
  ]
  const ctx: Ctx = {
    deps,
    job: safeJob,
    excludes: [],
    mode: decision.mode,
    runner: decision.mode === 'direct' ? 'source' : 'local',
    log: [],
    progress
  }
  if (decision.mode === undefined) {
    return { ...base, modeReason: decision.reason, facts, blocked: true }
  }

  const endpoint = endpointOf(safeJob)
  const sourceUp = parseContainerRunning(
    (await onSource(ctx, buildContainerProbeCommand(safeJob.container))).stdout
  )
  facts.push({
    id: 'container-source',
    label: 'Container on the source',
    status: sourceUp === true ? 'pass' : 'fail',
    value:
      sourceUp === true
        ? `${safeJob.container} is running on ${sourceName}`
        : `${safeJob.container} is not running on ${sourceName}`,
    ...(sourceUp === true ? {} : { detail: 'start the container before dumping it' })
  })
  const targetUp = parseContainerRunning(
    (await onTarget(ctx, buildContainerProbeCommand(safeJob.container))).stdout
  )
  facts.push({
    id: 'container-target',
    label: 'Container on the target',
    status: targetUp === true ? 'pass' : 'fail',
    value:
      targetUp === true
        ? `${safeJob.container} is running on ${targetName}`
        : `${safeJob.container} is not running on ${targetName}`,
    ...(targetUp === true
      ? {}
      : { detail: 'a restore needs the container that will hold the restored database' })
  })

  const estimatedBytes = parseNumberOutput(
    (await onSource(ctx, buildDatabaseEstimateCommand(endpoint))).stdout
  )
  facts.push({
    id: 'dump-size',
    label: 'Estimated dump size',
    status: estimatedBytes === undefined ? 'fail' : 'pass',
    value:
      estimatedBytes === undefined ? 'could not read pg_database_size' : formatBytes(estimatedBytes),
    ...(estimatedBytes === undefined
      ? { detail: 'without a size the target space cannot be checked' }
      : {})
  })

  const baseline = parseDatabaseBaseline(
    (await onSource(ctx, buildDatabaseBaselineCommand(endpoint, safeJob.sampleTables))).stdout
  )
  facts.push({
    id: 'baseline-source',
    label: 'Tables and rows on the source',
    status: baseline === undefined ? 'fail' : 'pass',
    value:
      baseline === undefined
        ? 'the source database could not be read'
        : `${baseline.tables} tables, ${baseline.sample.length} sampled for row counts`,
    ...(baseline === undefined
      ? { detail: 'without a baseline there is nothing to compare the restore against' }
      : {})
  })

  return {
    mode: decision.mode,
    modeReason: decision.reason,
    facts,
    blocked: facts.some((entry) => entry.status === 'fail'),
    dryRun: true,
    estimatedBytes: estimatedBytes ?? 0,
    dumpPath: safeJob.dumpPath,
    sampleTables: safeJob.sampleTables,
    steps: buildDatabaseSteps(safeJob, decision.mode, deps)
  }
}

/** The dry run a user approves: the plan, the estimate, and nothing written. */
export async function planDatabaseMigration(
  deps: MigrationFlowDeps,
  job: DatabaseJob,
  options: DatabaseRunOptions = {}
): Promise<DatabasePlan> {
  const progress = new Progress(options.onProgress)
  const plan = await preflightDatabase(deps, job, progress)
  progress.tick('done', `${plan.steps.length} step(s), nothing has run yet`)
  return plan
}

/** The plan as text: every fact with its mark, then every command. */
export function describeDatabasePlan(plan: DatabasePlan, job: DatabaseJob): string {
  const lines = [
    `Database plan: ${label(job)} on ${sourceLabelFor(job)} → ${targetLabelFor(job)}:${job.dumpPath}`,
    `Mode: ${plan.mode ?? 'none'} — ${plan.modeReason}`,
    `Estimated size: ${formatBytes(plan.estimatedBytes)}`,
    '',
    'Facts:'
  ]
  if (plan.facts.length === 0) lines.push('  (none)')
  for (const entry of plan.facts) {
    lines.push(`  ${entry.status.toUpperCase().padEnd(4)} ${entry.label}: ${entry.value}`)
  }
  lines.push('', 'Commands (nothing has run yet):')
  if (plan.steps.length === 0) lines.push('  (none)')
  for (const step of plan.steps) lines.push(`  - [${step.runner}] ${step.command}`)
  return lines.join('\n')
}

/** One executed step: what the mark is, and the one line that decided it. */
interface StepOutcome {
  result: MigrationExecOutcome
  status: 'pass' | 'fail'
  detail?: string
  data: {
    baseline?: DatabaseBaseline
    digest?: string
    bytes?: number
    existing?: string
  }
}

function outputLine(result: MigrationExecOutcome): string | undefined {
  const line = firstLine(result.stderr) || firstLine(result.stdout)
  return line === '' ? undefined : line.slice(0, 240)
}

async function executeStep(
  ctx: Ctx,
  deps: MigrationFlowDeps,
  job: DatabaseJob,
  step: DatabaseStep
): Promise<StepOutcome> {
  if (step.id === 'transfer' || step.id === 'pull' || step.id === 'push') {
    const result = await onRunner(ctx, transferArgv(deps, job, step.id))
    const detail = outputLine(result)
    return { result, status: result.ok ? 'pass' : 'fail', ...(detail === undefined ? {} : { detail }), data: {} }
  }
  const result = await (step.where === 'source'
    ? onSource(ctx, step.command)
    : onTarget(ctx, step.command))
  const detail = outputLine(result)

  if (step.id === 'container-source' || step.id === 'container-target') {
    const running = parseContainerRunning(result.stdout)
    return {
      result,
      status: running === true ? 'pass' : 'fail',
      detail: running === true ? 'running=true' : (detail ?? 'no answer from docker'),
      data: {}
    }
  }
  if (step.id === 'estimate') {
    const bytes = parseNumberOutput(result.stdout)
    return {
      result,
      status: bytes === undefined ? 'fail' : 'pass',
      ...(bytes === undefined ? { detail: detail ?? 'no number' } : {}),
      data: bytes === undefined ? {} : { bytes }
    }
  }
  if (step.id === 'baseline-source' || step.id === 'baseline-target') {
    const baseline = parseDatabaseBaseline(result.stdout)
    return {
      result,
      status: baseline === undefined ? 'fail' : 'pass',
      detail:
        baseline === undefined
          ? (detail ?? 'the query returned nothing')
          : `${baseline.tables} tables, ${baseline.sample.length} sampled`,
      data: baseline === undefined ? {} : { baseline }
    }
  }
  if (step.id === 'digest-source' || step.id === 'digest-target') {
    const parsed = parseDigestAndBytes(result.stdout)
    return {
      result,
      status: parsed.sha256 === undefined ? 'fail' : 'pass',
      detail:
        parsed.sha256 === undefined
          ? (detail ?? 'no digest')
          : `${parsed.sha256.slice(0, 12)} (${formatBytes(parsed.bytes ?? 0)})`,
      data: {
        ...(parsed.sha256 === undefined ? {} : { digest: parsed.sha256 }),
        ...(parsed.bytes === undefined ? {} : { bytes: parsed.bytes })
      }
    }
  }
  if (step.id === 'digest-existing') {
    const parsed = parseDigestAndBytes(result.stdout)
    const raw = (result.stdout ?? '').trim()
    const existing = parsed.sha256 ?? (/^none$/i.test(raw) ? 'none' : undefined)
    return {
      result,
      status: existing === undefined ? 'fail' : 'pass',
      detail:
        existing === undefined
          ? (detail ?? 'no answer')
          : existing === 'none'
            ? 'none (fresh run)'
            : existing.slice(0, 12),
      data: existing === undefined ? {} : { existing }
    }
  }
  /* Everything else is a command whose exit code is the answer (mkdir, pg_dump, pg_restore, …). */
  return {
    result,
    status: result.ok ? 'pass' : 'fail',
    ...(detail === undefined ? {} : { detail }),
    data: {}
  }
}

function skippedResult(step: DatabaseStep, detail: string): DatabaseStepResult {
  return {
    id: step.id,
    status: 'skipped',
    command: step.command,
    expect: step.expect,
    detail,
    durationMs: 0
  }
}

/** The progress phase a database step belongs to, in the vocabulary the transfer already emits. */
function phaseFor(id: DatabaseStepId): MigrationProgress['phase'] {
  switch (id) {
    case 'container-source':
    case 'container-target':
    case 'estimate':
    case 'prepare-target':
    case 'digest-existing':
      return 'preflight'
    case 'baseline-source':
    case 'prepare-source':
    case 'dump':
    case 'digest-source':
      return 'baseline'
    case 'transfer':
      return 'transfer'
    case 'pull':
      return 'pull'
    case 'push':
      return 'push'
    case 'digest-target':
      return 'verify'
    case 'prepare-database':
    case 'restore':
      return 'restore'
    case 'baseline-target':
      return 'verify-target'
  }
}

/**
 * Run it: dump, move, restore, compare.
 *
 * The only gates are the two digest checks and the comparison. A cancelled run keeps the dump on
 * both ends, so the next run resumes; a failed comparison commits nothing and names the table.
 */
export async function runDatabaseMigration(
  deps: MigrationFlowDeps,
  job: DatabaseJob,
  options: DatabaseRunOptions = {}
): Promise<DatabaseRun> {
  const now = options.now ?? Date.now
  const progress = new Progress(options.onProgress)
  const log: string[] = []
  const startedAt = now()
  /* A helper, not a comparison: TS narrows `options.signal?.aborted` after the early return below,
   * which would make the in-loop check "unintentional" in the compiler's eyes. */
  const isAborted = (): boolean => options.signal?.aborted === true
  const finish = (fields: Partial<DatabaseRun> & Pick<DatabaseRun, 'ok' | 'message' | 'plan'>): DatabaseRun => ({
    mode: fields.plan.mode,
    cancelled: false,
    resume: false,
    results: [],
    log,
    ...fields,
    startedAt,
    finishedAt: now()
  })

  if (isAborted()) {
    return finish({
      ok: false,
      cancelled: true,
      resume: true,
      plan: {
        mode: undefined,
        modeReason: 'cancelled before any byte moved',
        facts: [],
        blocked: true,
        dryRun: true,
        estimatedBytes: 0,
        dumpPath: job.dumpPath,
        sampleTables: job.sampleTables,
        steps: []
      },
      message: 'Cancelled before any byte moved. Nothing was written.'
    })
  }

  const plan = await preflightDatabase(deps, job, progress)

  if (options.dryRun === true) {
    progress.tick('done', 'dry run finished')
    return finish({
      ok: true,
      plan,
      message:
        `Dry run: ${plan.steps.length} step(s) planned for ${label(job)}, estimated ` +
        `${formatBytes(plan.estimatedBytes)}. Nothing has been written and no command that writes ` +
        'was run.'
    })
  }

  if (plan.blocked) {
    const failures = plan.facts.filter((entry) => entry.status === 'fail')
    const message = `Preflight failed, nothing was dumped — ${failures
      .map((entry) => `${entry.label}: ${entry.value}`)
      .join('; ')}`
    await deps.audit?.({
      type: 'exec',
      ok: false,
      serverId: job.source.serverId,
      command: `database ${label(job)} -> ${targetLabelFor(job)}`,
      detail: `preflight refused: ${message}`
    })
    return finish({ ok: false, plan, message })
  }

  const ctx: Ctx = {
    deps,
    job,
    excludes: [],
    mode: plan.mode,
    runner: plan.mode === 'direct' ? 'source' : 'local',
    log,
    progress
  }
  const results: DatabaseStepResult[] = []
  let sourceDigest: string | undefined
  let targetDigest: string | undefined
  let restoreExitCode: number | undefined
  let sourceBaseline: DatabaseBaseline | undefined
  let targetBaseline: DatabaseBaseline | undefined
  let resuming = false
  let stopped: string | undefined
  let cancelled = false

  for (const step of plan.steps) {
    if (stopped !== undefined) {
      results.push(skippedResult(step, `not run: ${stopped}`))
      continue
    }
    if (isAborted()) {
      cancelled = true
      results.push(skippedResult(step, 'not run: the run was cancelled'))
      continue
    }
    if (resuming && (step.id === 'pull' || step.id === 'push' || step.id === 'transfer')) {
      results.push(
        skippedResult(step, 'the target already holds this exact dump (verified by sha256)')
      )
      continue
    }
    progress.tick(phaseFor(step.id), step.title)
    const startedStep = now()
    const outcome = await executeStep(ctx, deps, job, step)
    results.push({
      id: step.id,
      status: outcome.status,
      command: step.command,
      expect: step.expect,
      ...(outcome.detail === undefined ? {} : { output: outcome.detail, detail: outcome.detail }),
      durationMs: Math.max(0, now() - startedStep)
    })

    if (step.id === 'baseline-source') sourceBaseline = outcome.data.baseline
    if (step.id === 'baseline-target') targetBaseline = outcome.data.baseline
    if (step.id === 'digest-source') {
      sourceDigest = outcome.data.digest
      if (sourceDigest === undefined) {
        stopped = 'the dump could not be hashed, so nothing can be verified'
      }
    }
    if (step.id === 'digest-existing') {
      const existing = outcome.data.existing
      resuming = existing !== undefined && existing !== 'none' && existing === sourceDigest
    }
    if (step.id === 'digest-target') {
      targetDigest = outcome.data.digest
      if (sourceDigest !== undefined && targetDigest !== sourceDigest) {
        stopped =
          'the dump that arrived does not hash to the dump that was taken, so nothing was restored'
      }
    }
    if (step.id === 'restore') restoreExitCode = outcome.result.exitCode
  }

  if (cancelled) {
    await deps.audit?.({
      type: 'exec',
      ok: false,
      serverId: job.source.serverId,
      command: `database ${label(job)} -> ${targetLabelFor(job)}`,
      detail: `cancelled; the dump is kept at ${job.dumpPath} on both ends`
    })
    return finish({
      ok: false,
      cancelled: true,
      resume: true,
      plan,
      results,
      message:
        `Cancelled. The dump at ${job.dumpPath} is kept on both ends, so running this again resumes. ` +
        'The target database was not touched.'
    })
  }

  if (sourceDigest === undefined || targetDigest === undefined || targetDigest !== sourceDigest) {
    const message =
      sourceDigest === undefined || targetDigest === undefined
        ? `The dump could not be verified by sha256 on ${targetLabelFor(job)}, so nothing was ` +
          `restored. ${stopped ?? ''}`.trim()
        : `The dump that arrived does not hash (sha256) to the dump that was taken: ` +
          `${targetDigest.slice(0, 12)} against ${sourceDigest.slice(0, 12)}, so nothing was restored.`
    await deps.audit?.({
      type: 'exec',
      ok: false,
      serverId: job.source.serverId,
      command: `database ${label(job)} -> ${targetLabelFor(job)}`,
      detail: `sha256 mismatch: ${sourceDigest ?? 'none'} != ${targetDigest ?? 'none'}`
    })
    return finish({
      ok: false,
      resume: true,
      plan,
      results,
      message: `${message} Staying resumable: the dump is kept at ${job.dumpPath}.`
    })
  }

  if (sourceBaseline === undefined || targetBaseline === undefined) {
    const message =
      `The restored database could not be read back on ${targetLabelFor(job)}, so the restore ` +
      `cannot be confirmed. The dump is kept at ${job.dumpPath}.`
    await deps.audit?.({
      type: 'exec',
      ok: false,
      serverId: job.source.serverId,
      command: `database ${label(job)} -> ${targetLabelFor(job)}`,
      detail: 'the target baseline could not be read'
    })
    return finish({ ok: false, resume: true, plan, results, message })
  }

  const problems = compareDatabaseBaselines(sourceBaseline, targetBaseline)
  const verificationBase = {
    tables: targetBaseline.tables,
    sample: targetBaseline.sample,
    sourceDigest,
    targetDigest,
    ...(restoreExitCode === undefined ? {} : { restoreExitCode })
  }
  if (problems.length > 0) {
    const verification: DatabaseVerification = {
      ...verificationBase,
      ok: false,
      message: `Database mismatch: ${problems.join('; ')}`,
      mismatches: problems
    }
    await deps.audit?.({
      type: 'exec',
      ok: false,
      serverId: job.source.serverId,
      command: `database ${label(job)} -> ${targetLabelFor(job)}`,
      detail: `verification mismatch: ${problems.join('; ')}`
    })
    return finish({
      ok: false,
      resume: true,
      plan,
      results,
      verification,
      message:
        `Database ${label(job)} on ${targetLabelFor(job)}: ${verification.message}. ` +
        `The dump is kept at ${job.dumpPath} for a second attempt.`
    })
  }

  const verification: DatabaseVerification = {
    ...verificationBase,
    ok: true,
    message:
      `Database matches: ${verificationBase.tables} tables, ${verificationBase.sample.length} ` +
      `sampled tables have identical row counts (dump sha256 ${(sourceDigest ?? '').slice(0, 12)}).`,
    mismatches: []
  }
  await deps.audit?.({
    type: 'exec',
    ok: true,
    serverId: job.source.serverId,
    command: `database ${label(job)} -> ${targetLabelFor(job)} (${plan.mode})`,
    detail:
      `restored; ${verification.tables} table(s), ${verification.sample.length} sampled; ` +
      `sha256 ${(sourceDigest ?? '').slice(0, 12)}`
  })
  progress.tick('done', job.dumpPath)
  return finish({
    ok: true,
    resume: resuming,
    plan,
    results,
    verification,
    message:
      `Database ${label(job)} restored on ${targetLabelFor(job)}: ${verification.message}`
  })
}
