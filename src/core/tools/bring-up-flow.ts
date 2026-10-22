/**
 * The target bring-up flow — S5.2.
 *
 * A checklist, not a conversation: `buildBringUpSteps` is a pure function that turns a resolved job
 * into commands with expected results, and `runBringUp` walks them, marking each one PASS or FAIL.
 * Cancelling stops at the next step boundary; resuming re-posts the ids that already passed and they
 * are marked `skipped` rather than re-run.
 *
 * It sits on top of S4's flow: the mode comes from `chooseMode` over the same reachability report,
 * and every command reaches a machine through `onSource`/`onTarget`/`onRunner`, so the host policy,
 * deny list, rate limiter and audit log are the same ones the transfer uses.
 *
 * The one thing this module will not do is print a secret: the `.env` step reads key names with
 * `sed`, the result carries `{ key, present }` pairs, and every step's output goes through the
 * project's redactor before it is stored or shown.
 */
import type { ReachabilityReport } from '@shared/vps'
import type {
  BringUpJob,
  BringUpPlan,
  BringUpProgress,
  BringUpRun,
  BringUpStep,
  BringUpStepId,
  BringUpStepResult,
  EnvKeyReport
} from '@shared/bring-up'
import { bareHost } from '@shared/host-address'
import { redact } from '@core/agent/redact'
import { checkMigrationPath } from './migrate-project-tool'
import { chooseMode } from './migrate-project-flow'
import { formatArgv } from './migrate-argv'
import {
  buildBuildCommand,
  buildCertbotCommand,
  buildCertsCheckCommand,
  buildCertsFetchArgv,
  buildCertsInstallArgv,
  buildEnvFileProbeCommand,
  buildEnvKeysCommand,
  buildHealthCommand,
  buildInstallCommand,
  buildNginxEnableCommand,
  buildNginxFetchArgv,
  buildNginxInstallArgv,
  buildNginxReloadCommand,
  buildNginxTestCommand,
  buildPm2SaveCommand,
  buildPm2StartCommand,
  buildPm2VerifyCommand,
  compareEnvKeys,
  defaultLocalStagingDir,
  missingPm2Apps,
  nginxTestPassed,
  parseEnvKeys,
  parseHttpStatus,
  parsePm2Apps
} from './bring-up-argv'
import {
  Progress,
  firstLine,
  onRunner,
  onSource,
  onTarget,
  sourceLabelFor,
  targetLabelFor,
  yes,
  type Ctx,
  type MigrationFlowDeps
} from './migrate-runner'

export type { EnvKeyReport }

export interface BringUpRunOptions {
  signal?: AbortSignal | undefined
  onProgress?: ((event: BringUpProgress) => void) | undefined
  now?: (() => number) | undefined
  /** Step ids an earlier run already passed. */
  completed?: readonly string[] | undefined
  /** Overrides the relay store; defaults to `/var/tmp/ai-desktop-migrate/<host>`. */
  localStagingDir?: string | undefined
}

const DOMAIN = /^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$/
const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/
const SAFE_NAME = /^[A-Za-z0-9_.:@-]+$/
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

/**
 * The one validation both the plan and the service use.
 *
 * Every value here is interpolated into a shell command, so this is an allow-list: a domain with a
 * space, a port of zero, a start script with a `;` or an env key of `A=1; rm` is refused before a
 * command exists.
 */
export function validateBringUpJob(job: BringUpJob): string | undefined {
  const checked = checkMigrationPath(job.projectPath)
  if (checked.reason !== undefined) return `project path: ${checked.reason}`
  if (!(checked.path ?? '').startsWith('/')) return `project path: ${job.projectPath} is not absolute`
  if (job.domains.length === 0) return 'at least one domain is needed for a certificate'
  for (const domain of job.domains) {
    if (!DOMAIN.test(domain)) return `invalid domain: ${JSON.stringify(domain)}`
  }
  if (job.certbotEmail === undefined || !EMAIL.test(job.certbotEmail)) {
    return 'certbot needs a contact email; it cannot run non-interactively without one'
  }
  if (!Number.isInteger(job.apiPort) || job.apiPort < 1 || job.apiPort > 65535) {
    return `invalid API port: ${job.apiPort}`
  }
  if (!Number.isInteger(job.webPort) || job.webPort < 1 || job.webPort > 65535) {
    return `invalid web port: ${job.webPort}`
  }
  for (const [label, value] of [
    ['API app name', job.apiApp],
    ['web app name', job.webApp],
    ['API start script', job.apiScript],
    ['web start script', job.webScript]
  ] as const) {
    if (!SAFE_NAME.test(value)) return `invalid ${label}: ${JSON.stringify(value)}`
  }
  for (const key of job.requiredEnvKeys) {
    if (!ENV_KEY.test(key)) return `invalid environment key: ${JSON.stringify(key)}`
  }
  return undefined
}

function remote(server: { username: string; host: string; port: number }): {
  username: string
  host: string
  port: number
} {
  return { username: server.username, host: server.host, port: server.port }
}

/**
 * The checklist, as data. Pure: no machine, no clock, no network.
 *
 * Relay adds the two fetch legs, because in the reported case `source → target:22` is filtered
 * upstream and the site and certificate files can only travel through this computer. Direct copies
 * them from the source server, where they already are.
 */
export function buildBringUpSteps(
  job: BringUpJob,
  mode: 'direct' | 'relay',
  localStagingDir: string = defaultLocalStagingDir(job.target.host)
): BringUpStep[] {
  const runner = mode === 'direct' ? 'source' : 'local'
  const targetName = targetLabelFor(job)
  const steps: BringUpStep[] = [
    {
      id: 'env-file',
      title: '.env is on the target',
      runner,
      where: 'target',
      command: buildEnvFileProbeCommand(job.projectPath),
      expected: `.env is present in ${job.projectPath} on ${targetName}`,
      note: '.env is not part of the transfer: it holds secrets, so it is copied by hand or by this step’s check.'
    },
    {
      id: 'env-keys',
      title: '.env has its keys',
      runner,
      where: 'target',
      command: buildEnvKeysCommand(job.projectPath),
      expected: `${job.requiredEnvKeys.join(', ')} present in .env (values are never read)`,
      note: 'Only key names are printed. No command in this checklist prints a value.'
    },
    {
      id: 'install',
      title: 'Dependencies installed',
      runner,
      where: 'target',
      command: buildInstallCommand(job.projectPath),
      expected: 'npm ci exits 0 (the lockfile decides, so the target matches the source)'
    },
    {
      id: 'build',
      title: 'Built',
      runner,
      where: 'target',
      command: buildBuildCommand(job.projectPath),
      expected: 'npm run build exits 0'
    },
    {
      id: 'pm2-api',
      title: `PM2 starts ${job.apiApp}`,
      runner,
      where: 'target',
      command: buildPm2StartCommand({
        projectPath: job.projectPath,
        app: job.apiApp,
        script: job.apiScript,
        port: job.apiPort
      }),
      expected: `${job.apiApp} is online under pm2 with PORT=${job.apiPort}`
    },
    {
      id: 'pm2-web',
      title: `PM2 starts ${job.webApp}`,
      runner,
      where: 'target',
      command: buildPm2StartCommand({
        projectPath: job.projectPath,
        app: job.webApp,
        script: job.webScript,
        port: job.webPort
      }),
      expected: `${job.webApp} is online under pm2 with PORT=${job.webPort}`
    },
    {
      id: 'pm2-verify',
      title: 'PM2 says both are online',
      runner,
      where: 'target',
      command: buildPm2VerifyCommand(),
      expected: `${job.apiApp} and ${job.webApp} both report online`
    },
    {
      id: 'pm2-save',
      title: 'PM2 process list saved',
      runner,
      where: 'target',
      command: buildPm2SaveCommand(),
      expected: 'pm2 save exits 0, so a reboot brings both back'
    }
  ]

  if (mode === 'relay') {
    steps.push({
      id: 'nginx-fetch',
      title: 'Site files collected here',
      runner: 'local',
      where: 'source',
      command: formatArgv(
        buildNginxFetchArgv({
          source: remote(job.source),
          localDir: localStagingDir,
          domains: job.domains
        })
      ),
      expected: `both site files are under ${localStagingDir}/nginx/`
    })
  }
  steps.push({
    id: 'nginx-install',
    title: 'Site files on the target',
    runner,
    where: 'target',
    command: formatArgv(
      buildNginxInstallArgv({
        target: remote(job.target),
        ...(mode === 'relay' ? { fromLocalDir: localStagingDir } : {}),
        domains: job.domains
      })
    ),
    expected: `both site files are in /etc/nginx/sites-available on ${targetName}`
  })
  steps.push({
    id: 'nginx-enable',
    title: 'Sites enabled',
    runner,
    where: 'target',
    command: buildNginxEnableCommand(job.domains),
    expected: `both sites are linked into /etc/nginx/sites-enabled on ${targetName}`
  })

  if (mode === 'relay') {
    steps.push({
      id: 'certs-fetch',
      title: 'Certificates collected here',
      runner: 'local',
      where: 'source',
      command: formatArgv(buildCertsFetchArgv({ source: remote(job.source), localDir: localStagingDir })),
      expected: `the letsencrypt directory is under ${localStagingDir}/letsencrypt/`
    })
  }
  steps.push(
    {
      id: 'certs-install',
      title: 'Certificates on the target',
      runner,
      where: 'target',
      command: formatArgv(
        buildCertsInstallArgv({
          target: remote(job.target),
          ...(mode === 'relay' ? { fromLocalDir: localStagingDir } : {})
        })
      ),
      expected: `/etc/letsencrypt is on ${targetName}, with the same live/ paths the sites reference`
    },
    {
      id: 'certs-check',
      title: 'Both live certificates exist',
      runner,
      where: 'target',
      command: buildCertsCheckCommand(job.domains),
      expected: `fullchain.pem exists for ${job.domains.join(', ')} on ${targetName}`
    },
    {
      id: 'nginx-test',
      title: 'nginx accepts the configuration',
      runner,
      where: 'target',
      command: buildNginxTestCommand(),
      expected: 'nginx -t prints "test is successful" and no [emerg] line',
      note: 'Run after the certificates land: the site configs reference /etc/letsencrypt/live/…'
    },
    {
      id: 'nginx-reload',
      title: 'nginx reloaded',
      runner,
      where: 'target',
      command: buildNginxReloadCommand(),
      expected: 'the running server picks up the new sites without dropping connections'
    }
  )

  for (const domain of job.domains) {
    steps.push({
      id: `certbot:${domain}`,
      title: `Certificate for ${domain}`,
      runner,
      where: 'target',
      command: buildCertbotCommand(domain, job.certbotEmail ?? ''),
      expected: `a certificate for ${domain} is issued or still valid`,
      note: 'certbot needs the DNS for this name to point at this server first; that is a manual step, not a command in this checklist.'
    })
  }

  steps.push(
    {
      id: 'health-api',
      title: `API answers on :${job.apiPort}`,
      runner,
      where: 'target',
      command: buildHealthCommand(job.apiPort),
      expected: `:${job.apiPort} answers with an HTTP status below 500`
    },
    {
      id: 'health-web',
      title: `Web answers on :${job.webPort}`,
      runner,
      where: 'target',
      command: buildHealthCommand(job.webPort),
      expected: `:${job.webPort} answers with an HTTP status below 500`
    }
  )
  return steps
}

/** Decide the mode, validate the job, and hand back the checklist. Runs no command. */
export async function planBringUp(
  deps: Pick<MigrationFlowDeps, 'reachability'>,
  job: BringUpJob,
  options: BringUpRunOptions = {}
): Promise<BringUpPlan> {
  const problem = validateBringUpJob(job)
  const facts: BringUpPlan['facts'] = []
  if (problem !== undefined) {
    const id = problem.startsWith('project path')
      ? 'project-path'
      : problem.startsWith('certbot')
        ? 'certbot-email'
        : problem.startsWith('invalid domain') || problem.startsWith('at least one domain')
          ? 'domains'
          : 'params'
    facts.push({ id, label: 'Parameters', status: 'fail', value: problem })
    return { mode: 'relay', modeReason: problem, facts, blocked: true, steps: [] }
  }

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
  facts.push({
    id: 'reachability',
    label: 'Path to the target',
    status: decision.blocked ? 'fail' : 'pass',
    value: decision.reason,
    ...(report === undefined ? {} : { detail: report.summary })
  })
  facts.push({
    id: 'certbot-email',
    label: 'Certificate contact',
    status: 'pass',
    value: job.certbotEmail ?? ''
  })
  if (decision.mode === undefined) {
    return {
      mode: 'relay',
      modeReason: decision.reason,
      facts,
      blocked: true,
      steps: []
    }
  }
  const steps = buildBringUpSteps(
    job,
    decision.mode,
    options.localStagingDir ?? defaultLocalStagingDir(job.target.host)
  )
  facts.push({
    id: 'steps',
    label: 'Checklist',
    status: 'pass',
    value: `${steps.length} step(s), each with a command and an expected result`
  })
  return {
    mode: decision.mode,
    modeReason: decision.reason,
    facts,
    blocked: false,
    steps
  }
}

interface StepOutcome {
  ok: boolean
  detail?: string
  /** The redacted line of output, kept apart from the sentence so a leak is visible as [REDACTED]. */
  output?: string
  env?: EnvKeyReport[]
}

function targetFor(job: BringUpJob): string {
  return targetLabelFor(job)
}

function outputLine(text: string | undefined): string | undefined {
  const line = firstLine(text ?? '')
  return line === '' ? undefined : redact(line).slice(0, 240)
}

/** The argv for the two legs that copy files, when this computer is the one running them. */
function copyArgv(job: BringUpJob, step: BringUpStep, localStagingDir: string): string[] | undefined {
  if (step.id === 'nginx-fetch') {
    return buildNginxFetchArgv({ source: remote(job.source), localDir: localStagingDir, domains: job.domains })
  }
  if (step.id === 'certs-fetch') {
    return buildCertsFetchArgv({ source: remote(job.source), localDir: localStagingDir })
  }
  if (step.id === 'nginx-install') {
    return buildNginxInstallArgv({
      target: remote(job.target),
      ...(step.runner === 'local' ? { fromLocalDir: localStagingDir } : {}),
      domains: job.domains
    })
  }
  if (step.id === 'certs-install') {
    return buildCertsInstallArgv({
      target: remote(job.target),
      ...(step.runner === 'local' ? { fromLocalDir: localStagingDir } : {})
    })
  }
  return undefined
}

async function executeStep(
  ctx: Ctx,
  job: BringUpJob,
  step: BringUpStep,
  localStagingDir: string
): Promise<StepOutcome> {
  const argv = copyArgv(job, step, localStagingDir)
  const result =
    argv !== undefined
      ? await onRunner(ctx, argv)
      : step.where === 'source'
        ? await onSource(ctx, step.command)
        : await onTarget(ctx, step.command)
  const line = outputLine(result.stderr) ?? outputLine(result.stdout)

  if (step.id === 'env-file') {
    return {
      ok: yes(result),
      ...(line === undefined ? {} : { output: line }),
      ...(yes(result) ? {} : { detail: `no .env in ${job.projectPath}` })
    }
  }
  if (step.id === 'env-keys') {
    const keys = parseEnvKeys(result.stdout)
    const env = compareEnvKeys(keys, job.requiredEnvKeys)
    const missing = env.filter((entry) => !entry.present).map((entry) => entry.key)
    return {
      ok: missing.length === 0,
      env,
      /* The raw line is kept only through the redactor, so an echoed value becomes [REDACTED]. */
      ...(line === undefined ? {} : { output: line }),
      detail:
        missing.length === 0
          ? `${job.requiredEnvKeys.join(', ')} present (values never read)`
          : `missing: ${missing.join(', ')}`
    }
  }
  if (step.id === 'pm2-verify') {
    const apps = parsePm2Apps(result.stdout)
    const appNames = [job.apiApp, job.webApp]
    const missing = missingPm2Apps(apps, appNames)
    return {
      ok: missing.length === 0,
      ...(line === undefined ? {} : { output: line }),
      detail:
        missing.length === 0
          ? `${appNames.join(' and ')} are online`
          : `not online: ${missing.join(', ')}`
    }
  }
  if (step.id === 'nginx-test') {
    const passed = result.ok && nginxTestPassed(result.stdout, result.stderr)
    return {
      ok: passed,
      ...(line === undefined ? {} : { output: line }),
      ...(passed ? {} : { detail: line ?? 'nginx -t did not report success' })
    }
  }
  if (step.id === 'certs-check') {
    return {
      ok: yes(result),
      ...(line === undefined ? {} : { output: line }),
      ...(yes(result) ? {} : { detail: 'a live certificate is missing' })
    }
  }
  if (step.id === 'health-api' || step.id === 'health-web') {
    const port = step.id === 'health-api' ? job.apiPort : job.webPort
    const status = parseHttpStatus(result.stdout)
    if (status === undefined) {
      return { ok: false, detail: line ?? `no answer on 127.0.0.1:${port}` }
    }
    if (status === 0) {
      return { ok: false, detail: `no answer on 127.0.0.1:${port} (curl could not connect)` }
    }
    if (status >= 500) {
      return { ok: false, detail: `HTTP ${status} on 127.0.0.1:${port}` }
    }
    return { ok: true, detail: `HTTP ${status} on 127.0.0.1:${port}` }
  }
  return {
    ok: result.ok,
    ...(line === undefined ? {} : { output: line }),
    ...(result.ok ? {} : { detail: line ?? `exited ${result.exitCode}` })
  }
}

function skipped(step: BringUpStep, detail: string): BringUpStepResult {
  return {
    id: step.id,
    status: 'skipped',
    command: step.command,
    expected: step.expected,
    detail,
    durationMs: 0
  }
}

/** Walk the checklist. Cancellable between steps, resumable from the ids that passed. */
export async function runBringUp(
  deps: MigrationFlowDeps,
  job: BringUpJob,
  options: BringUpRunOptions = {}
): Promise<BringUpRun> {
  const now = options.now ?? Date.now
  const startedAt = now()
  const log: string[] = []
  const localStagingDir = options.localStagingDir ?? deps.localStagingDir ?? defaultLocalStagingDir(job.target.host)
  const emit = (
    step: BringUpStep,
    status: BringUpProgress['status'],
    index: number,
    total: number
  ): void => {
    options.onProgress?.({
      step: step.id,
      status,
      index,
      total,
      phase: status === 'pass' ? 'commit' : status === 'fail' ? 'commit' : 'preflight'
    })
  }
  const plan = await planBringUp(deps, job, { ...options, localStagingDir })
  const finish = (
    fields: Partial<BringUpRun> & Pick<BringUpRun, 'ok' | 'message'>
  ): BringUpRun => ({
    cancelled: false,
    resume: false,
    mode: plan.mode,
    plan,
    results: [],
    log,
    ...fields,
    startedAt,
    finishedAt: now()
  })

  if (plan.blocked) {
    const failures = plan.facts.filter((entry) => entry.status === 'fail')
    const message = `Preflight failed, nothing was run — ${failures
      .map((entry) => entry.value)
      .join('; ')}`
    await deps.audit?.({
      type: 'exec',
      ok: false,
      serverId: job.source.serverId,
      command: `bring-up ${job.projectPath} on ${targetFor(job)}`,
      detail: `preflight refused: ${message}`
    })
    return finish({ ok: false, message, results: [] })
  }

  const ctx: Ctx = {
    deps,
    job,
    excludes: [],
    mode: plan.mode,
    runner: plan.mode === 'direct' ? 'source' : 'local',
    log,
    /* The checklist emits its own per-step progress; `Ctx` still wants a sink for the phases. */
    progress: new Progress(undefined)
  }
  const results: BringUpStepResult[] = []
  let env: EnvKeyReport[] | undefined
  let stoppedAt: BringUpStepResult | undefined
  let cancelled = false
  const total = plan.steps.length

  for (const [index, step] of plan.steps.entries()) {
    if (stoppedAt !== undefined) {
      results.push(skipped(step, `not run: step ${stoppedAt.id} failed`))
      emit(step, 'skipped', index + 1, total)
      continue
    }
    if (options.signal?.aborted === true) {
      cancelled = true
      results.push(skipped(step, 'not run: the checklist was cancelled'))
      emit(step, 'skipped', index + 1, total)
      continue
    }
    if (options.completed?.includes(step.id) === true) {
      results.push(skipped(step, 'already passed in an earlier run'))
      emit(step, 'skipped', index + 1, total)
      continue
    }
    emit(step, 'start', index + 1, total)
    const startedStep = now()
    const outcome = await executeStep(ctx, job, step, localStagingDir)
    if (outcome.env !== undefined) env = outcome.env
    const record: BringUpStepResult = {
      id: step.id,
      status: outcome.ok ? 'pass' : 'fail',
      command: step.command,
      expected: step.expected,
      ...(outcome.output === undefined ? {} : { output: outcome.output }),
      ...(outcome.detail === undefined ? {} : { detail: outcome.detail }),
      durationMs: Math.max(0, now() - startedStep)
    }
    results.push(record)
    emit(step, outcome.ok ? 'pass' : 'fail', index + 1, total)
    /* A failed health check is one app's verdict, not a reason to hide the other one. */
    if (!outcome.ok && step.id !== 'health-api' && step.id !== 'health-web') stoppedAt = record
  }

  const passed = results.filter((result) => result.status === 'pass').length
  const failed = results.filter((result) => result.status === 'fail')
  const resumed = options.completed !== undefined && options.completed.length > 0
  const audit = async (ok: boolean, detail: string): Promise<void> => {
    await deps.audit?.({
      type: 'exec',
      ok,
      serverId: job.source.serverId,
      command: `bring-up ${job.projectPath} on ${targetFor(job)} (${plan.mode})`,
      detail
    })
  }

  if (cancelled) {
    await audit(false, `cancelled after ${passed} of ${total} step(s)`)
    return finish({
      ok: false,
      cancelled: true,
      resume: true,
      plan,
      results,
      ...(env === undefined ? {} : { env }),
      message:
        `Cancelled after ${passed} of ${total} steps. The steps that passed are kept, so Continue ` +
        'resumes from there instead of starting over.'
    })
  }

  if (stoppedAt !== undefined) {
    await audit(false, `stopped at ${stoppedAt.id}: ${stoppedAt.detail ?? stoppedAt.expected}`)
    return finish({
      ok: false,
      resume: true,
      plan,
      results,
      ...(env === undefined ? {} : { env }),
      message:
        `The checklist stopped at ${stoppedAt.id} — ${stoppedAt.detail ?? stoppedAt.expected}. ` +
        `${passed} of ${total} steps passed; fix it and Continue resumes from here.`
    })
  }

  if (failed.length > 0) {
    await audit(false, `${failed.map((result) => result.id).join(', ')} failed`)
    return finish({
      ok: false,
      resume: true,
      plan,
      results,
      ...(env === undefined ? {} : { env }),
      message:
        `The checklist ran to the end but ${failed.length} check(s) failed: ` +
        `${failed.map((result) => `${result.id} — ${result.detail ?? result.expected}`).join('; ')}. ` +
        `${passed} of ${total} steps passed.`
    })
  }

  await audit(true, `${passed} of ${total} step(s) passed`)
  return finish({
    ok: true,
    resume: resumed,
    plan,
    results,
    ...(env === undefined ? {} : { env }),
    message: `The checklist finished: ${passed} of ${total} steps passed on ${targetFor(job)}.`
  })
}

/** The plan as text, for a surface that has no table: the command, then what it should do. */
export function describeBringUpPlan(plan: BringUpPlan, job: BringUpJob): string {
  const lines = [
    `Bring-up checklist: ${job.projectPath} on ${targetLabelFor(job)} (from ${sourceLabelFor(job)})`,
    `Mode: ${plan.mode} — ${plan.modeReason}`,
    ''
  ]
  if (plan.facts.length > 0) {
    lines.push('Facts:')
    for (const entry of plan.facts) {
      lines.push(`  ${entry.status.toUpperCase().padEnd(4)} ${entry.label}: ${entry.value}`)
    }
    lines.push('')
  }
  lines.push('Steps (nothing has run yet):')
  plan.steps.forEach((step, index) => {
    lines.push(`  ${index + 1}. ${step.title}`)
    lines.push(`     $ ${step.command}`)
    lines.push(`     expect: ${step.expected}`)
    if (step.note !== undefined) lines.push(`     note: ${step.note}`)
  })
  return lines.join('\n')
}

/** Re-exported so a caller needs one import for the step ids it stores between runs. */
export type { BringUpStepId }
export { compareEnvKeys }
