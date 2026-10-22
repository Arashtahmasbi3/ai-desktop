/**
 * Running a migration — S4.5 (verification) and S4.6 (progress, cancel, resume).
 *
 * The order is the safety property. A run can end at any step and the destination is still either
 * absent or the previous one; the only command that can create it is the `mv -T`, and it runs after
 * the numbers and the sampled checksum agree. A cancelled or failed run keeps the staging directory,
 * and because its name is derived rather than random, re-running the plan resumes from what is there.
 */
import type {
  MigrationBaseline,
  MigrationJob,
  MigrationPlan,
  MigrationRun,
  MigrationVerification
} from '@shared/migration'
import { shellQuote } from '@shared/shell-quote'
import { formatBytes } from './migrate-project-tool'
import {
  buildBaselineCommand,
  buildRsyncArgv,
  buildSampleHashCommand,
  formatArgv,
  localStagingPathFor,
  parseBaseline,
  parseDigest,
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
import { preflightMigration } from './migrate-project-flow'

/** Every way the two trees disagree, as sentences a user can act on. */
export function compareTrees(source: MigrationBaseline, target: MigrationBaseline): string[] {
  const problems: string[] = []
  for (const key of ['files', 'dirs', 'bytes'] as const) {
    if (source[key] !== target[key]) {
      problems.push(`${key} ${source[key]} on the source but ${target[key]} on the target`)
    }
  }
  const from = [...source.top].sort().join('\n')
  const to = [...target.top].sort().join('\n')
  if (from !== to) {
    problems.push(
      `top-level entries differ: ${source.top.join(' ') || '(none)'} on the source, ${
        target.top.join(' ') || '(none)'
      } on the target`
    )
  }
  return problems
}

export function aborted(options: MigrationRunOptions): boolean {
  return options.signal?.aborted === true
}

export function cancelledRun(plan: MigrationPlan, log: string[], message: string): MigrationRun {
  return {
    ok: false,
    mode: plan.mode,
    cancelled: true,
    resume: true,
    plan,
    stagingPath: plan.stagingPath,
    log,
    message
  }
}

export function stopMessage(staging: string, target: string): string {
  return (
    `The staging directory ${staging} is kept, so running the migration again will resume from what ` +
    `is already there. Nothing was written to ${target}.`
  )
}

/**
 * Run the plan: baseline, transfer, verify, rename.
 *
 * The order is the safety property. A run can end at any step and the destination is still either
 * absent or the previous one; the only command that can create it is the `mv -T`, and it runs after
 * the numbers and the sample checksum agree.
 */
export async function runMigration(
  deps: MigrationFlowDeps,
  job: MigrationJob,
  options: MigrationRunOptions = {}
): Promise<MigrationRun> {
  const progress = new Progress(options.onProgress)
  const log: string[] = []
  const early = emptyPlan(validateExcludes(job.excludes).excludes)
  if (aborted(options)) {
    return cancelledRun(
      { ...early, modeReason: 'cancelled before any byte moved' },
      log,
      'Cancelled before any byte moved.'
    )
  }

  const plan = await preflightMigration(deps, job, options, progress)
  const targetName = targetLabelFor(job)
  const sourceName = sourceLabelFor(job)
  const staging = plan.stagingPath ?? stagingPathFor(job.target.path)

  if (plan.blocked) {
    const failures = plan.facts
      .filter((entry) => entry.status === 'fail')
      .map((entry) => `${entry.label}: ${entry.value}`)
    const message = `Preflight failed, nothing was transferred — ${failures.join('; ')}`
    await deps.audit?.({
      type: 'exec',
      ok: false,
      serverId: job.source.serverId,
      command: `migrate ${job.source.path} -> ${targetName}:${job.target.path}`,
      detail: `preflight refused: ${failures.join('; ')}`
    })
    return { ok: false, mode: plan.mode, cancelled: false, resume: plan.resume, plan, log, message }
  }

  const ctx: Ctx = {
    deps,
    job,
    excludes: plan.excludes,
    mode: plan.mode,
    runner: plan.mode === 'direct' ? 'source' : 'local',
    log,
    progress
  }
  const source = job.source.path
  const target = job.target.path
  const targetRemote = { username: job.target.username, host: job.target.host, port: job.target.port }
  const localStaging = localStagingPathFor(deps.localStagingDir, target)
  const stop = (
    message: string,
    resume: boolean,
    verification?: MigrationVerification
  ): MigrationRun => ({
    ok: false,
    mode: plan.mode,
    cancelled: false,
    resume,
    plan,
    stagingPath: staging,
    ...(verification === undefined ? {} : { verification }),
    log,
    message
  })

  /** What the comparison saw, kept on the failure so the numbers are shown rather than described. */
  const seen = (targetTree: MigrationBaseline, ok: boolean, message: string): MigrationVerification => ({
    ok,
    message,
    files: targetTree.files,
    dirs: targetTree.dirs,
    bytes: targetTree.bytes,
    top: targetTree.top
  })

  // --- baseline, re-read at transfer time so the comparison is against now ---
  progress.tick('baseline', source)
  const baselineOutcome = await onSource(ctx, buildBaselineCommand(source, plan.excludes))
  const sourceBaseline = parseBaseline(baselineOutcome.stdout) ?? plan.baseline
  if (sourceBaseline === undefined) {
    return stop(
      `The source baseline could not be read, so a migration could not be verified. ${firstLine(
        baselineOutcome.stderr
      )}`,
      false
    )
  }

  // --- the transfer ---------------------------------------------------------
  if (plan.mode === 'direct') {
    progress.tick('transfer', `rsync to ${targetName}`, plan.estimateBytes)
    const outcome = await onRunner(
      ctx,
      buildRsyncArgv({ from: source, to: { ...targetRemote, path: staging }, excludes: plan.excludes })
    )
    if (!outcome.ok) {
      /* A kill (Cancel) and a real rsync failure both exit non-zero; only the signal tells them apart. */
      if (aborted(options)) {
        return cancelledRun(plan, log, `Transfer cancelled. ${stopMessage(staging, target)}`)
      }
      return stop(
        `Transfer exited with code ${outcome.exitCode}: ${firstLine(outcome.stderr) || 'no reason given'}. ` +
          stopMessage(staging, target),
        true
      )
    }
  } else {
    progress.tick('pull', `pull from ${sourceName}`, plan.estimateBytes)
    const pull = await onRunner(
      ctx,
      buildRsyncArgv({
        from: {
          username: job.source.username,
          host: job.source.host,
          port: job.source.port,
          path: source
        },
        to: localStaging,
        excludes: plan.excludes
      })
    )
    if (!pull.ok) {
      if (aborted(options)) {
        return cancelledRun(plan, log, `Transfer cancelled. ${stopMessage(staging, target)}`)
      }
      return stop(
        `The pull from ${sourceName} exited with code ${pull.exitCode}: ${
          firstLine(pull.stderr) || 'no reason given'
        }. ` + stopMessage(staging, target),
        true
      )
    }
    if (aborted(options)) {
      return cancelledRun(
        plan,
        log,
        `Transfer cancelled. ${stopMessage(staging, target)}`
      )
    }
    progress.tick('push', `push to ${targetName}`, plan.estimateBytes)
    const push = await onRunner(
      ctx,
      buildRsyncArgv({
        from: localStaging,
        to: { ...targetRemote, path: staging },
        excludes: plan.excludes
      })
    )
    if (!push.ok) {
      if (aborted(options)) {
        return cancelledRun(plan, log, `Transfer cancelled. ${stopMessage(staging, target)}`)
      }
      return stop(
        `The push to ${targetName} exited with code ${push.exitCode}: ${
          firstLine(push.stderr) || 'no reason given'
        }. ` + stopMessage(staging, target),
        true
      )
    }
  }

  // --- verification: numbers first, then a sample of the bytes --------------
  progress.tick('verify', `counting ${staging} on ${targetName}`)
  const targetBaselineOutcome = await onTarget(ctx, buildBaselineCommand(staging, plan.excludes))
  const targetBaseline = parseBaseline(targetBaselineOutcome.stdout)
  if (targetBaseline === undefined) {
    return stop(
      `The migrated tree could not be counted on ${targetName}, so the transfer cannot be confirmed. ${firstLine(
        targetBaselineOutcome.stderr
      )}`,
      true
    )
  }
  const problems = compareTrees(sourceBaseline, targetBaseline)
  if (problems.length > 0) {
    await deps.audit?.({
      type: 'exec',
      ok: false,
      serverId: job.source.serverId,
      command: `migrate ${source} -> ${targetName}:${target}`,
      detail: `verification mismatch: ${problems.join('; ')}`
    })
    return stop(
      `Verification mismatch: ${problems.join('; ')}. The destination was not committed; ${staging} is ` +
        'kept for inspection or a resume.',
      true,
      seen(targetBaseline, false, `Mismatch: ${problems.join('; ')}`)
    )
  }

  const sampleSize = options.sampleSize === undefined ? 20 : options.sampleSize
  const stride = Math.max(1, Math.floor((sourceBaseline.files || 0) / Math.max(1, sampleSize)))
  const sourceDigest = parseDigest(
    (await onSource(ctx, buildSampleHashCommand(source, plan.excludes, stride, sampleSize))).stdout
  )
  progress.tick('verify-target', `checksum of ${Math.min(sampleSize, sourceBaseline.files)} files`)
  const targetDigest = parseDigest(
    (await onTarget(ctx, buildSampleHashCommand(staging, plan.excludes, stride, sampleSize))).stdout
  )
  if (sourceDigest === undefined || targetDigest === undefined) {
    return stop(
      `The sampled checksum could not be computed on ${
        sourceDigest === undefined ? 'the source' : `the copy on ${targetName}`
      }, so the transfer cannot be confirmed. ${staging} is kept.`,
      true
    )
  }
  if (sourceDigest !== targetDigest) {
    await deps.audit?.({
      type: 'exec',
      ok: false,
      serverId: job.source.serverId,
      command: `migrate ${source} -> ${targetName}:${target}`,
      detail: `checksum mismatch: ${sourceDigest} != ${targetDigest}`
    })
    const problem =
      `Checksum mismatch: the sampled files hash to ${sourceDigest.slice(0, 12)} on the source but ` +
      `${targetDigest.slice(0, 12)} on ${targetName}. The destination was not committed; ${staging} is kept.`
    return stop(problem, true, seen(targetBaseline, false, problem))
  }

  // --- commit: the one command that can create the destination --------------
  if (aborted(options)) {
    return cancelledRun(plan, log, `Transfer cancelled. ${stopMessage(staging, target)}`)
  }
  progress.tick('commit', `mv -T ${staging} ${target}`)
  const appeared = await onTarget(ctx, `test -e ${shellQuote(target)} && echo yes || echo no`)
  if (yes(appeared)) {
    return stop(
      `${target} appeared on ${targetName} while the transfer was running, so it was not overwritten. ` +
        `The verified copy is at ${staging}.`,
      true
    )
  }
  const commit = await onTarget(ctx, formatArgv(['mv', '-T', staging, target]))
  if (!commit.ok) {
    return stop(
      `The verified copy could not be renamed into place (exit ${commit.exitCode}: ${
        firstLine(commit.stderr) || 'no reason given'
      }). It is complete at ${staging}.`,
      true
    )
  }

  const verification: MigrationVerification = {
    ok: true,
    message:
      `Verified: ${targetBaseline.files} files, ${targetBaseline.dirs} directories, ` +
      `${formatBytes(targetBaseline.bytes)}, sample checksum matched (${sourceDigest.slice(0, 12)}).`,
    files: targetBaseline.files,
    dirs: targetBaseline.dirs,
    bytes: targetBaseline.bytes,
    top: targetBaseline.top,
    sampleDigest: sourceDigest,
    sourceDigest,
    targetDigest
  }
  await deps.audit?.({
    type: 'exec',
    ok: true,
    serverId: job.source.serverId,
    command: `migrate ${source} -> ${targetName}:${target} (${plan.mode})`,
    detail: `exit 0; ${verification.files} file(s), ${verification.dirs} dir(s), ${formatBytes(
      verification.bytes
    )}; sample ${sourceDigest.slice(0, 12)}`
  })
  progress.tick('done', target)

  return {
    ok: true,
    mode: plan.mode,
    cancelled: false,
    resume: false,
    plan,
    verification,
    stagingPath: staging,
    committedTo: target,
    log,
    message:
      `Migrated ${source} from ${sourceName} to ${targetName}:${target} via ${plan.mode}. ` +
      verification.message
  }
}
