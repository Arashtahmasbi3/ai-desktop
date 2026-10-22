/**
 * The migration flow — S4.2, S4.3, S4.5, S4.6.
 *
 * One function decides the mode from evidence, one builds the plan, one runs it. Everything that
 * touches a machine is injected, so the whole decision can be tested against exact argv without a
 * socket, a subprocess or a byte moving:
 *
 *   `execOnSource(command)` — the app's own SSH session to the source server (a shell command).
 *   `execLocal(argv)`      — this computer, an **exact argv** with no shell in between.
 *   `reachability(target)` — the existing three-path probe (`@core/remote/reachability`), reused.
 *
 * Three decisions worth stating, because each one replaces a plausible alternative:
 *
 * 1. **The mode is chosen from the probe, not from the user.** `direct` when `source → target:22`
 *    is open, `relay` when only `this computer → target` is. In the reported case the first path is
 *    filtered upstream by the provider and the second is open, so relay is the only working answer —
 *    and it is derived from two observed facts rather than offered as a choice.
 *
 * 2. **Bytes land in a staging directory, and the destination appears in one `mv -T`.** rsync writes
 *    `<target>.migrating` and only a verified tree is renamed into place. The alternative
 *    (`--partial-dir` inside the real destination) leaves a directory that *looks* complete while it
 *    is not, which is exactly the failure mode S4.6 forbids. Because the staging name is derived
 *    (`.migrating`, not a random suffix) an interrupted run **resumes** by re-running the same plan,
 *    and `--partial` keeps the one in-flight file so a 2 GB file is not restarted from zero.
 *
 * 3. **A mismatch is a failure, never a warning.** File count, directory count, total bytes,
 *    top-level entries and a sampled checksum are compared to the source; any difference stops the
 *    run before the rename and keeps the staging directory for inspection.
 */

import type { ReachabilityReport } from '@shared/vps'
import type {
  MigrationFact,
  MigrationFactStatus,
  MigrationJob,
  MigrationMode,
  MigrationPlan
} from '@shared/migration'
import { shellQuote } from '@shared/shell-quote'
import { bareHost } from '@shared/host-address'
import { checkMigrationPath, formatBytes } from './migrate-project-tool'
import {
  RUNTIME_TOOLS,
  buildBaselineCommand,
  buildDiskFreeCommand,
  buildEstimateCommand,
  buildRsyncArgv,
  buildSampleHashCommand,
  buildSshRemoteArgv,
  buildStagingProbeCommand,
  buildVersionCommand,
  formatArgv,
  localStagingPathFor,
  parentPath,
  parseBaseline,
  parseDf,
  parseEstimate,
  parseStagingProbe,
  parseVersions,
  stagingPathFor,
  validateExcludes
} from './migrate-argv'
import {
  Progress,
  emptyPlan,
  firstLine,
  onRunner,
  onSource,
  onTarget,
  sourceLabelFor,
  targetLabelFor,
  yes,
  type Ctx,
  type MigrationFlowDeps,
  type MigrationRunOptions
} from './migrate-runner'

/* The public surface of the flow: the deps/deps-options types and the command formatter. */
export type { MigrationFlowDeps, MigrationRunOptions } from './migrate-runner'
export { formatArgv } from './migrate-argv'
export { DEFAULT_MIGRATION_EXCLUDES } from '@shared/migration'

export interface ModeDecision {
  mode?: MigrationMode | undefined
  reason: string
  blocked: boolean
}

function stateOf(open: boolean | null): string {
  return open === null ? 'not tested' : open ? 'open' : 'closed'
}

/**
 * Which way the bytes should travel, from what the three probes actually observed.
 *
 * A path nobody probed (`open: null`) is never treated as closed — it is a reason to prefer the path
 * that *was* proven, which is how an unobserved source path still ends up as a workable relay. If no
 * path is open the plan is blocked with the evidence, rather than with the old "the target is
 * unreachable" (which was wrong: the target was listening the whole time).
 */
export function chooseMode(report: ReachabilityReport): ModeDecision {
  const source = report.source.open
  const local = report.local.open
  const evidence = `source → target:${report.port} is ${stateOf(source)}; this computer → target:${
    report.port
  } is ${stateOf(local)}`
  if (source === true && local === true) {
    return {
      mode: 'direct',
      blocked: false,
      reason: `Both paths are open (${evidence}), so the direct transfer runs from the source server.`
    }
  }
  if (source === true) {
    return {
      mode: 'direct',
      blocked: false,
      reason: `source → target:${report.port} is open, so the direct transfer runs from the source server.`
    }
  }
  if (local === true) {
    const why =
      source === false
        ? `source → target:${report.port} is closed (${report.source.detail ?? 'no reason given'})`
        : `source → target:${report.port} was not tested, so the source is not proven as a path`
    return {
      mode: 'relay',
      blocked: false,
      reason: `${why}, and this computer reaches it, so the transfer relays through this computer.`
    }
  }
  return {
    mode: undefined,
    blocked: true,
    reason: `Neither path to ${report.host}:${report.port} is open (${evidence}). ${report.summary}`
  }
}

interface PathChoice {
  path?: string
  reason?: string
}

/** An absolute POSIX path, or the reason it is not one. Reuses the tool's own path check. */
function absolutePath(raw: string): PathChoice {
  const checked = checkMigrationPath(raw)
  if (checked.reason !== undefined) return { reason: checked.reason }
  const path = checked.path ?? ''
  if (!path.startsWith('/')) return { reason: `${path} is not an absolute path` }
  return { path }
}

function fact(
  id: string,
  label: string,
  status: MigrationFactStatus,
  value: string,
  detail?: string
): MigrationFact {
  return { id, label, status, value, ...(detail === undefined ? {} : { detail }) }
}

/**
 * Build the plan: validate, probe, decide, and print the exact commands.
 *
 * Nothing here copies a byte. The two writes it does perform are metadata and are both necessary
 * before rsync can run at all: `mkdir -p` on the destination's parent, and nothing else.
 */
export async function preflightMigration(
  deps: MigrationFlowDeps,
  job: MigrationJob,
  options: MigrationRunOptions = {},
  progress = new Progress(options.onProgress)
): Promise<MigrationPlan> {
  const checkedExcludes = validateExcludes(job.excludes)
  const excludes = checkedExcludes.excludes
  const base = emptyPlan(excludes)
  progress.tick('preflight', `${job.source.path} → ${job.target.path}`)

  const sourcePath = absolutePath(job.source.path)
  const targetPath = absolutePath(job.target.path)
  const pathProblems = [
    ...(sourcePath.reason === undefined ? [] : [`source: ${sourcePath.reason}`]),
    ...(targetPath.reason === undefined ? [] : [`target: ${targetPath.reason}`]),
    ...(checkedExcludes.reason === undefined ? [] : [`excludes: ${checkedExcludes.reason}`])
  ]
  if (pathProblems.length > 0) {
    const reason = pathProblems.join('; ')
    return {
      ...base,
      modeReason: `the plan cannot be built — ${reason}`,
      facts: [fact('path-source', 'Paths', 'fail', reason)]
    }
  }
  const source = sourcePath.path as string
  const target = targetPath.path as string

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
  const ctx: Ctx = {
    deps,
    job,
    excludes,
    mode: decision.mode,
    runner: decision.mode === 'direct' ? 'source' : 'local',
    log: [],
    progress
  }
  const targetName = targetLabelFor(job)
  const runnerLabel = ctx.runner === 'source' ? sourceLabelFor(job) : 'this computer'
  const facts: MigrationFact[] = [
    fact(
      'reachability',
      'Path to the target',
      decision.blocked ? 'fail' : 'pass',
      decision.reason,
      report?.summary
    )
  ]
  if (decision.mode === undefined) {
    return {
      ...base,
      modeReason: decision.reason,
      facts,
      blocked: true,
      ...(report === undefined ? {} : { reachabilitySummary: report.summary })
    }
  }

  const staging = stagingPathFor(target)
  const parent = parentPath(target)

  // --- the two ends exist, and the destination is free ------------------------
  const sourcePresent = await onSource(ctx, `test -d ${shellQuote(source)} && echo yes || echo no`)
  facts.push(
    fact(
      'path-source',
      'Source path',
      yes(sourcePresent) ? 'pass' : 'fail',
      yes(sourcePresent) ? `${source} exists` : `${source} does not exist on ${sourceLabelFor(job)}`
    )
  )
  const targetTaken = await onTarget(ctx, `test -e ${shellQuote(target)} && echo yes || echo no`)
  const taken = yes(targetTaken)
  facts.push(
    fact(
      'path-target',
      'Destination path',
      taken ? 'fail' : 'pass',
      taken ? `${target} already exists on ${targetName}` : `${target} is free on ${targetName}`,
      taken ? 'move it aside or choose a destination that does not exist — a migration never merges' : undefined
    )
  )
  const parentReady = await onTarget(ctx, `mkdir -p ${shellQuote(parent)}`)
  facts.push(
    fact(
      'path-parent',
      'Destination parent',
      parentReady.ok ? 'pass' : 'fail',
      parent,
      parentReady.ok ? undefined : firstLine(parentReady.stderr) || 'could not create the parent directory'
    )
  )

  // --- what is already staged (resume) --------------------------------------
  const stagingProbe = await onTarget(ctx, buildStagingProbeCommand(staging))
  const staged = parseStagingProbe(stagingProbe.stdout)
  const stagedBytes = staged.exists ? staged.kb * 1024 : 0
  facts.push(
    fact(
      'staging',
      'Staging directory',
      'pass',
      staged.exists
        ? `resume: ${formatBytes(stagedBytes)} already staged in ${staging}`
        : `${staging} (fresh transfer)`
    )
  )

  // --- space on both ends (the source 89% case) -----------------------------
  const sourceDisk = parseDf((await onSource(ctx, buildDiskFreeCommand(source))).stdout)
  const percent = sourceDisk?.percent
  facts.push(
    fact(
      'source-fill',
      'Free space on the source',
      percent === undefined ? 'warn' : percent > 85 ? 'warn' : 'pass',
      percent === undefined
        ? 'could not read the source disk usage'
        : `${percent}% full (${formatBytes((sourceDisk?.availKb ?? 0) * 1024)} free)`,
      percent !== undefined && percent > 85
        ? 'the source is nearly full; the excludes are what make the transfer fit, and the source is never written to'
        : undefined
    )
  )

  const estimate = parseEstimate((await onSource(ctx, buildEstimateCommand(source, excludes))).stdout)
  facts.push(
    fact(
      'estimate',
      'Size after the excludes',
      estimate === undefined ? 'fail' : 'pass',
      estimate === undefined ? 'could not measure the source tree' : formatBytes(estimate),
      estimate === undefined ? 'without a size the target space cannot be checked' : undefined
    )
  )
  const needed = Math.max(0, (estimate ?? 0) - stagedBytes)

  const targetDisk = parseDf((await onTarget(ctx, buildDiskFreeCommand(parent))).stdout)
  const available = targetDisk === undefined ? undefined : targetDisk.availKb * 1024
  const enoughSpace = available !== undefined && available >= needed
  facts.push(
    fact(
      'target-space',
      'Free space on the target',
      available === undefined ? 'fail' : enoughSpace ? 'pass' : 'fail',
      `${available === undefined ? 'unknown' : formatBytes(available)} free / ${formatBytes(needed)} needed`,
      available === undefined
        ? 'could not read the free space on the target'
        : enoughSpace
          ? undefined
          : 'not enough free space on the target for this transfer'
    )
  )

  if (decision.mode === 'relay') {
    let here: number | undefined
    try {
      here = deps.localFreeBytes === undefined ? undefined : await deps.localFreeBytes()
    } catch {
      here = undefined
    }
    facts.push(
      fact(
        'local-space',
        'Free space on this computer',
        here === undefined ? 'warn' : here >= needed ? 'pass' : 'fail',
        `${here === undefined ? 'unknown' : formatBytes(here)} free / ${formatBytes(needed)} needed`,
        here === undefined
          ? 'the relay keeps a full copy here until the target has it'
          : here >= needed
            ? undefined
            : `not enough free space here for the relay copy; direct mode would not need it, but this path is filtered`
      )
    )
  }

  // --- ssh keys and rsync ----------------------------------------------------
  const keyToTarget = await onTarget(ctx, 'true')
  facts.push(
    fact(
      'key-runner-target',
      'SSH key to the target',
      keyToTarget.ok ? 'pass' : 'fail',
      keyToTarget.ok
        ? `${runnerLabel} authenticates to ${targetName} with a key`
        : `${runnerLabel} cannot authenticate to ${targetName} with a key`,
      keyToTarget.ok ? undefined : firstLine(keyToTarget.stderr) || 'BatchMode refused a password prompt'
    )
  )
  if (decision.mode === 'relay') {
    const keyToSource = await onRunner(
      ctx,
      buildSshRemoteArgv(
        { username: job.source.username, host: job.source.host, port: job.source.port },
        'true'
      )
    )
    facts.push(
      fact(
        'key-local-source',
        'SSH key to the source',
        keyToSource.ok ? 'pass' : 'fail',
        keyToSource.ok
          ? `this computer authenticates to ${sourceLabelFor(job)} with a key`
          : `this computer cannot authenticate to ${sourceLabelFor(job)} with a key`,
        keyToSource.ok
          ? 'the relay pulls from the source, so this key is required as well'
          : firstLine(keyToSource.stderr) || 'BatchMode refused a password prompt'
      )
    )
  }

  const rsyncOnRunner =
    ctx.runner === 'source'
      ? await onSource(ctx, 'rsync --version')
      : await onRunner(ctx, ['rsync', '--version'])
  facts.push(
    fact(
      'rsync-runner',
      `rsync on ${runnerLabel}`,
      rsyncOnRunner.ok ? 'pass' : 'fail',
      rsyncOnRunner.ok ? firstLine(rsyncOnRunner.stdout) || 'rsync present' : 'rsync is not installed here',
      rsyncOnRunner.ok ? undefined : `install rsync on ${runnerLabel}; it is the machine that would run the transfer`
    )
  )
  const rsyncOnTarget = await onTarget(ctx, 'command -v rsync')
  facts.push(
    fact(
      'rsync-target',
      `rsync on ${targetName}`,
      rsyncOnTarget.ok ? 'pass' : 'fail',
      rsyncOnTarget.ok ? firstLine(rsyncOnTarget.stdout) || 'rsync present' : 'rsync is not installed there',
      rsyncOnTarget.ok ? undefined : 'rsync runs its remote half on the destination as well'
    )
  )

  // --- the four runtimes, both ends ----------------------------------------
  const sourceVersions = parseVersions((await onSource(ctx, buildVersionCommand())).stdout)
  const targetVersions = parseVersions((await onTarget(ctx, buildVersionCommand())).stdout)
  for (const tool of RUNTIME_TOOLS) {
    const from = sourceVersions[tool]
    const to = targetVersions[tool]
    const agree = from !== undefined && to !== undefined && from === to
    facts.push(
      fact(
        `version-${tool}`,
        `${tool} version`,
        agree ? 'pass' : 'warn',
        `source ${from ?? 'not installed'} / target ${to ?? 'not installed'}`,
        agree ? undefined : 'version skew: the destination is not the same runtime as the source'
      )
    )
  }

  // --- the exact commands ---------------------------------------------------
  const baseline = parseBaseline((await onSource(ctx, buildBaselineCommand(source, excludes))).stdout)
  const sampleSize = options.sampleSize === undefined ? 20 : options.sampleSize
  const stride = Math.max(1, Math.floor((baseline?.files ?? 0) / Math.max(1, sampleSize)))
  const targetRemote = {
    username: job.target.username,
    host: job.target.host,
    port: job.target.port
  }
  const localStaging = localStagingPathFor(deps.localStagingDir, target)

  const steps: MigrationPlan['steps'] = [
    { id: 'baseline', runner: 'source', where: 'source', command: buildBaselineCommand(source, excludes) }
  ]
  if (decision.mode === 'direct') {
    steps.push({
      id: 'transfer',
      runner: 'source',
      where: 'target',
      command: formatArgv(
        buildRsyncArgv({ from: source, to: { ...targetRemote, path: staging }, excludes })
      )
    })
  } else {
    steps.push({
      id: 'pull',
      runner: 'local',
      where: 'source',
      command: formatArgv(
        buildRsyncArgv({
          from: { username: job.source.username, host: job.source.host, port: job.source.port, path: source },
          to: localStaging,
          excludes
        })
      )
    })
    steps.push({
      id: 'push',
      runner: 'local',
      where: 'target',
      command: formatArgv(
        buildRsyncArgv({ from: localStaging, to: { ...targetRemote, path: staging }, excludes })
      )
    })
  }
  steps.push({
    id: 'verify',
    runner: 'source',
    where: 'source',
    command: buildSampleHashCommand(source, excludes, stride, sampleSize)
  })
  steps.push({
    id: 'verify-target',
    runner: ctx.runner,
    where: 'target',
    command: formatArgv(
      buildSshRemoteArgv(targetRemote, buildSampleHashCommand(staging, excludes, stride, sampleSize))
    )
  })
  steps.push({
    id: 'commit',
    runner: ctx.runner,
    where: 'target',
    command: formatArgv(
      buildSshRemoteArgv(targetRemote, formatArgv(['mv', '-T', staging, target]))
    )
  })

  return {
    mode: decision.mode,
    modeReason: decision.reason,
    facts,
    excludes,
    blocked: facts.some((entry) => entry.status === 'fail'),
    estimateBytes: estimate ?? 0,
    stagedBytes,
    resume: staged.exists,
    stagingPath: staging,
    baseline,
    steps,
    ...(report === undefined ? {} : { reachabilitySummary: report.summary })
  }
}

/**
 * The plan as text: every fact with its mark, then every command.
 *
 * This is what a text surface (the agent's tool result, a log) shows, and it deliberately prints the
 * commands verbatim so the answer to "what will run?" is never a summary.
 */
export function describeMigrationPlan(plan: MigrationPlan, job: MigrationJob): string {
  const lines = [
    `Migration plan: ${job.source.path} on ${sourceLabelFor(job)} → ${job.target.name ?? job.target.host}:${job.target.path}`,
    `Mode: ${plan.mode ?? 'none'} — ${plan.modeReason}`,
    '',
    'Facts:'
  ]
  if (plan.facts.length === 0) lines.push('  (none)')
  for (const entry of plan.facts) {
    const detail = entry.detail === undefined ? '' : ` (${entry.detail})`
    lines.push(`  ${entry.status.toUpperCase().padEnd(4)} ${entry.label}: ${entry.value}${detail}`)
  }
  lines.push('', `Excludes: ${plan.excludes.join(', ') || '(none)'}`)
  lines.push('', 'Commands (nothing has run yet):')
  if (plan.steps.length === 0) lines.push('  (none)')
  for (const step of plan.steps) lines.push(`  - [${step.runner}] ${step.command}`)
  return lines.join('\n')
}

/* The command layer's public surface plus the defaults: one import for a caller of the flow. */