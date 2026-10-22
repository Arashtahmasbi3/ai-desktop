import { describe, expect, it } from 'vitest'
import type {
  DatabaseBaseline,
  DatabaseJob,
  DatabasePlan
} from '../../src/shared/database-migration'
import type { MigrationEndpoint, MigrationExecOutcome, MigrationProgress } from '../../src/shared/migration'
import type { ReachabilityReport, PortFact } from '../../src/shared/vps'
import type { MigrationFlowDeps } from '../../src/core/tools/migrate-runner'
import { formatArgv } from '../../src/core/tools/migrate-argv'
import {
  compareDatabaseBaselines,
  describeDatabasePlan,
  planDatabaseMigration,
  runDatabaseMigration
} from '../../src/core/tools/db-migrate-flow'

/**
 * S5.1 — the dry-run, the real run, and the comparison that turns a partial restore into a loud
 * failure.
 *
 * Every machine is injected: `execOnSource` is the app's SSH session, `execLocal` is this computer
 * as an exact argv, and the target is reached over ssh from whichever of the two ran the transfer.
 * No docker, no psql, no socket, no network — the assertions are about which command reached which
 * machine, and about what the numbers mean afterwards.
 */

const SOURCE: MigrationEndpoint = {
  serverId: 'srv-spmotor',
  name: 'spmotor',
  host: '91.107.174.210',
  port: 22,
  username: 'root',
  path: '/opt/zoonestore'
}

const TARGET: MigrationEndpoint = {
  serverId: 'srv-yoserver',
  name: 'yoserver-spmotor',
  host: '212.16.86.23',
  port: 22,
  username: 'root',
  path: '/opt/zoonestore'
}

const DUMP = '/var/tmp/ai-desktop-db/zoonestore.dump'

const JOB: DatabaseJob = {
  source: SOURCE,
  target: TARGET,
  container: 'zoonestore-postgres',
  database: 'zoonestore',
  user: 'postgres',
  dumpPath: DUMP,
  sampleTables: 20
}

const DIGEST = 'a'.repeat(64)

function fact(from: PortFact['from'], open: boolean | null): PortFact {
  return { from, open, at: 1_700_000_000_000 }
}

function relayReport(): ReachabilityReport {
  return {
    host: '212.16.86.23',
    port: 22,
    source: fact('source', false),
    local: fact('local', true),
    target: fact('target', null),
    agreement: 'local-only',
    summary: '212.16.86.23:22 is open from this computer and closed from spmotor.',
    nextSteps: []
  }
}

function directReport(): ReachabilityReport {
  return { ...relayReport(), source: fact('source', true), agreement: 'all-open' }
}

interface Call {
  where: 'source' | 'local'
  command: string
  argv?: string[]
}

interface Harness {
  deps: MigrationFlowDeps
  calls: Call[]
  audits: string[]
  progress: MigrationProgress[]
}

interface Answers {
  /** `stdout` when `where === 'source'` and the command is not an ssh wrap of the target. */
  sourceBaseline?: string
  targetBaseline?: string
  targetExistingDigest?: string
  targetTransferDigest?: string
  targetRestoreOk?: boolean
  reach?: ReachabilityReport
  sourceProgress?: number
}

function harness(answers: Answers = {}): Harness {
  const calls: Call[] = []
  const audits: string[] = []
  const progress: MigrationProgress[] = []
  const sourceBaseline = answers.sourceBaseline ?? 'tables=37\nrows=accounts=1204\nusers=88\n'
  const targetBaseline = answers.targetBaseline ?? sourceBaseline
  const existing = answers.targetExistingDigest ?? 'none'
  const transferred = answers.targetTransferDigest ?? `sha256=${DIGEST}\nbytes=524288000\n`
  let digestAsked = 0

  const commandFor = (call: Call): MigrationExecOutcome => {
    const target = call.command.trimStart().startsWith('ssh ')
    const command = call.command
    let stdout = ''
    if (command.includes('{{.State.Running}}')) stdout = 'true\n'
    else if (command.includes('pg_database_size')) stdout = '4800000000\n'
    else if (command.includes("tables=%s")) stdout = target ? targetBaseline : sourceBaseline
    else if (command.includes('pg_dump ')) stdout = ''
    else if (command.includes('sha256=') && command.includes('[ -f ')) stdout = existing === 'none' ? 'none\n' : existing
    else if (command.includes('sha256=')) {
      digestAsked += 1
      stdout = target ? transferred : `sha256=${DIGEST}\nbytes=524288000\n`
    } else if (command.includes('pg_restore')) {
      return answers.targetRestoreOk === false
        ? { ok: false, stdout: '', stderr: 'pg_restore: error: could not execute query', exitCode: 1 }
        : { ok: true, stdout: '', stderr: '', exitCode: 0 }
    } else if (command.startsWith('rsync')) stdout = ''
    else if (command.includes('mkdir -p')) stdout = ''
    else if (command.includes('pg_database where datname')) stdout = ''
    void digestAsked
    return { ok: true, stdout, stderr: '', exitCode: 0 }
  }

  const deps: MigrationFlowDeps = {
    execOnSource: async (command) => {
      const call: Call = { where: 'source', command }
      calls.push(call)
      return commandFor(call)
    },
    execLocal: async (argv) => {
      const call: Call = { where: 'local', command: formatArgv(argv), argv: [...argv] }
      calls.push(call)
      return commandFor(call)
    },
    localStagingDir: '/var/tmp/ai-desktop-migrate/212.16.86.23',
    reachability: async () => answers.reach ?? relayReport(),
    localFreeBytes: async () => 200_000_000_000,
    audit: async (entry) => {
      audits.push(`${entry.ok}:${entry.command ?? ''}`)
    }
  }
  return { deps, calls, audits, progress }
}

const MUTATING = /pg_dump |pg_restore |rsync |createdb |mkdir -p/

describe('S5.1 — the dry run prints the exact commands and writes nothing', () => {
  it('builds every command, in order, and estimates the size from the catalog', async () => {
    const h = harness()
    const plan = await planDatabaseMigration(h.deps, JOB, {
      now: () => 1_700_000_000_000,
      onProgress: (event) => h.progress.push(event)
    })

    expect(plan.dryRun).toBe(true)
    expect(plan.blocked).toBe(false)
    expect(plan.mode).toBe('relay')
    expect(plan.estimatedBytes).toBe(4_800_000_000)
    expect(plan.dumpPath).toBe(DUMP)
    expect(plan.steps.map((step) => step.id)).toEqual([
      'container-source',
      'container-target',
      'estimate',
      'baseline-source',
      'prepare-source',
      'dump',
      'digest-source',
      'prepare-target',
      'digest-existing',
      'pull',
      'push',
      'digest-target',
      'prepare-database',
      'restore',
      'baseline-target'
    ])
    // The exact command a user will approve for each step is on the step itself.
    const dump = plan.steps.find((step) => step.id === 'dump')
    expect(dump?.command).toBe(
      `docker exec zoonestore-postgres pg_dump -w -U postgres -Fc -d zoonestore > ${DUMP}`
    )
    const restore = plan.steps.find((step) => step.id === 'restore')
    expect(restore?.command).toContain('pg_restore')
    expect(restore?.command).toContain(`< ${DUMP}`)
    // Progress reaches "done" and nothing beyond it.
    expect(h.progress.at(-1)?.phase).toBe('done')
    expect(h.progress.at(-1)?.percent).toBe(100)
  })

  it('runs only read-only probes: no dump, no restore, no rsync, no mkdir', async () => {
    const h = harness()
    await planDatabaseMigration(h.deps, JOB)
    for (const call of h.calls) expect(call.command).not.toMatch(MUTATING)
    expect(h.calls.length).toBeGreaterThan(0)
    expect(h.audits).toEqual([])
  })

  it('a run asked to dry-run stops after the plan, even if the caller meant it', async () => {
    const h = harness()
    const run = await runDatabaseMigration(h.deps, JOB, { dryRun: true })
    expect(run.ok).toBe(true)
    expect(run.results).toEqual([])
    expect(run.message).toMatch(/dry run/i)
    for (const call of h.calls) expect(call.command).not.toMatch(MUTATING)
  })

  it('describes itself in text with the estimate and every command', async () => {
    const plan = await planDatabaseMigration(harness().deps, JOB)
    const text = describeDatabasePlan(plan, JOB)
    expect(text).toContain('relay')
    expect(text).toContain('4.5 GB')
    expect(text).toContain('pg_dump')
    expect(text).toContain('pg_restore')
    expect(text).toMatch(/nothing has run yet/i)
  })

  it('refuses a container name that could be read as a flag, before running anything', async () => {
    const h = harness()
    const plan = await planDatabaseMigration(h.deps, { ...JOB, container: '--rm' })
    expect(plan.blocked).toBe(true)
    expect(plan.facts[0]?.status).toBe('fail')
    expect(h.calls).toEqual([])
  })
})

describe('S5.1 — the real run, in the acceptance case (relay)', () => {
  it('dumps on the source, relays the file, restores on the target and compares', async () => {
    const h = harness()
    const run = await runDatabaseMigration(h.deps, JOB, {
      now: () => 1_700_000_000_000
    })

    expect(run.ok).toBe(true)
    expect(run.cancelled).toBe(false)
    expect(run.verification?.ok).toBe(true)
    expect(run.verification?.tables).toBe(37)
    expect(run.verification?.mismatches).toEqual([])
    expect(run.message).toContain('37 tables')
    expect(run.message).toContain('zoonestore')

    // The dump happened on the source session, through docker.
    expect(
      h.calls.some(
        (call) =>
          call.where === 'source' &&
          call.command.includes('pg_dump') &&
          call.command.includes('docker exec zoonestore-postgres')
      )
    ).toBe(true)
    // The restore ran on the target, over ssh, from this computer (relay), reading the dump on
    // the target — the bytes never pass through this process.
    const restore = h.calls.find((call) => call.command.includes('pg_restore'))
    expect(restore?.where).toBe('local')
    expect(restore?.command.startsWith('ssh -p 22')).toBe(true)
    expect(restore?.command).toContain('root@212.16.86.23')
    // Two rsync legs, both on this computer.
    const rsyncs = h.calls.filter((call) => call.command.startsWith('rsync '))
    expect(rsyncs).toHaveLength(2)
    expect(rsyncs[0]?.command).toContain('root@91.107.174.210:')
    expect(rsyncs[1]?.command).toContain('root@212.16.86.23:')
    // One audit entry for the whole run, and it is a success.
    expect(h.audits).toHaveLength(1)
    expect(h.audits[0]?.startsWith('true:')).toBe(true)
  })

  it('runs the transfer once, on the source, when the path is direct', async () => {
    const h = harness({ reach: directReport() })
    const run = await runDatabaseMigration(h.deps, JOB)
    expect(run.ok).toBe(true)
    expect(run.plan.mode).toBe('direct')
    const rsyncs = h.calls.filter((call) => call.command.startsWith('rsync '))
    expect(rsyncs).toHaveLength(1)
    expect(rsyncs[0]?.where).toBe('source')
    expect(h.calls.every((call) => call.where === 'source')).toBe(true)
  })

  it('skips the transfer when the target already holds this exact dump (a resume)', async () => {
    const h = harness({ targetExistingDigest: `sha256=${DIGEST}` })
    const run = await runDatabaseMigration(h.deps, JOB)
    expect(run.ok).toBe(true)
    expect(run.resume).toBe(true)
    expect(h.calls.filter((call) => call.command.startsWith('rsync '))).toEqual([])
    const transfer = run.results.find((result) => result.id === 'pull')
    expect(transfer?.status).toBe('skipped')
    expect(transfer?.detail).toMatch(/already/i)
  })

  it('times itself from the injected clock, never from Date.now', async () => {
    let clock = 5_000
    const h = harness()
    const run = await runDatabaseMigration(h.deps, JOB, {
      now: () => {
        clock += 250
        return clock
      }
    })
    expect(run.startedAt).toBe(5_250)
    expect(run.finishedAt).toBeGreaterThan(run.startedAt)
    expect(run.results.every((result) => result.durationMs === 250)).toBe(true)
  })
})

describe('S5.1 — a partial restore is a loud failure, never a warning', () => {
  it('fails when the target has fewer tables, and says how many on each side', async () => {
    const h = harness({ targetBaseline: 'tables=35\nrows=accounts=1204\nusers=88\n' })
    const run = await runDatabaseMigration(h.deps, JOB)

    expect(run.ok).toBe(false)
    expect(run.verification?.ok).toBe(false)
    expect(run.verification?.mismatches.join(' ')).toMatch(/37.*35/)
    expect(run.message).toMatch(/mismatch/i)
    // The failure is audited as a failure, not swallowed.
    expect(h.audits).toHaveLength(1)
    expect(h.audits[0]?.startsWith('false:')).toBe(true)
  })

  it('fails when one sampled table has a different row count, and names the table', async () => {
    const h = harness({ targetBaseline: 'tables=37\nrows=accounts=1200\nusers=88\n' })
    const run = await runDatabaseMigration(h.deps, JOB)

    expect(run.ok).toBe(false)
    expect(run.message).toContain('accounts')
    expect(run.message).toMatch(/1204/)
    expect(run.message).toMatch(/1200/)
  })

  it('fails when a sampled table is missing on the target', async () => {
    const h = harness({ targetBaseline: 'tables=37\nrows=users=88\n' })
    const run = await runDatabaseMigration(h.deps, JOB)
    expect(run.ok).toBe(false)
    expect(run.message).toContain('accounts')
    expect(h.audits[0]?.startsWith('false:')).toBe(true)
  })

  it('fails when the received dump does not hash to the dump that was taken', async () => {
    const h = harness({ targetTransferDigest: `sha256=${'b'.repeat(64)}\nbytes=524288000\n` })
    const run = await runDatabaseMigration(h.deps, JOB)

    expect(run.ok).toBe(false)
    expect(run.message).toMatch(/sha256|checksum/i)
    // Nothing was restored into the target database.
    expect(h.calls.some((call) => call.command.includes('pg_restore'))).toBe(false)
  })

  it('fails when the target database cannot be read back at all', async () => {
    const h = harness({ targetBaseline: 'psql: error: connection refused\n' })
    const run = await runDatabaseMigration(h.deps, JOB)
    expect(run.ok).toBe(false)
    expect(run.message).toMatch(/could not be read|could not be counted|not read/i)
  })

  it('reports a non-zero pg_restore exit but lets the comparison decide', async () => {
    const h = harness({ targetRestoreOk: false })
    const run = await runDatabaseMigration(h.deps, JOB)
    // The baseline still matched, so the run passes — with the exit code recorded, not hidden.
    expect(run.verification?.ok).toBe(true)
    expect(run.verification?.restoreExitCode).toBe(1)
    expect(run.results.find((result) => result.id === 'restore')?.output).toMatch(/pg_restore: error/)
  })
})

describe('S5.1 — stop, resume, and one audit entry per run', () => {
  it('a cancel before the dump returns a resumable run and writes nothing', async () => {
    const h = harness()
    const controller = new AbortController()
    controller.abort()
    const run = await runDatabaseMigration(h.deps, JOB, { signal: controller.signal })

    expect(run.cancelled).toBe(true)
    expect(run.ok).toBe(false)
    expect(run.resume).toBe(true)
    expect(h.calls).toEqual([])
    expect(h.audits).toEqual([])
  })

  it('a cancel mid-run stops before the next mutating step', async () => {
    const controller = new AbortController()
    const h = harness()
    const deps: MigrationFlowDeps = {
      ...h.deps,
      execOnSource: async (command) => {
        const outcome = await h.deps.execOnSource(command)
        if (command.includes('pg_dump')) controller.abort()
        return outcome
      }
    }
    const run = await runDatabaseMigration(deps, JOB, { signal: controller.signal })
    expect(run.cancelled).toBe(true)
    expect(run.resume).toBe(true)
    expect(h.calls.some((call) => call.command.includes('pg_restore'))).toBe(false)
  })

  it('a previous run’s passed steps are offered back as the resume point', async () => {
    const h = harness()
    const run = await runDatabaseMigration(h.deps, JOB)
    expect(run.results.filter((result) => result.status === 'pass').map((result) => result.id)).toContain(
      'restore'
    )
  })
})

describe('S5.1 — the comparison itself, pure', () => {
  const source: DatabaseBaseline = {
    tables: 37,
    sample: [
      { table: 'accounts', rows: 1204 },
      { table: 'users', rows: 88 }
    ]
  }

  it('agrees with itself', () => {
    expect(compareDatabaseBaselines(source, source)).toEqual([])
  })

  it('compares sample order-independently', () => {
    const target: DatabaseBaseline = { tables: 37, sample: [...source.sample].reverse() }
    expect(compareDatabaseBaselines(source, target)).toEqual([])
  })

  it('names every difference, not just the first', () => {
    const target: DatabaseBaseline = {
      tables: 36,
      sample: [
        { table: 'accounts', rows: 1 },
        { table: 'users', rows: 99 }
      ]
    }
    const problems = compareDatabaseBaselines(source, target)
    expect(problems).toHaveLength(3)
    expect(problems.join(' ')).toContain('36')
    expect(problems.join(' ')).toContain('accounts')
    expect(problems.join(' ')).toContain('users')
  })

  it('names a table that is on the source but not in the target’s sample', () => {
    const target: DatabaseBaseline = {
      tables: 37,
      sample: [{ table: 'users', rows: 88 }]
    }
    expect(compareDatabaseBaselines(source, target).join(' ')).toMatch(/accounts.*not/)
  })
})

describe('S5.1 — the plan is a plan, not a claim', () => {
  it('says which path was observed for the mode it chose', async () => {
    const plan: DatabasePlan = await planDatabaseMigration(harness().deps, JOB)
    expect(plan.modeReason).toContain('relay')
    expect(plan.facts.find((entry) => entry.id === 'dump-size')?.value).toContain('4.5 GB')
    expect(plan.facts.find((entry) => entry.id === 'reachability')?.status).toBe('pass')
  })

  it('blocks when neither path to the target is open, and stops there', async () => {
    const closed: ReachabilityReport = {
      ...relayReport(),
      local: fact('local', false),
      agreement: 'all-closed'
    }
    const h = harness({ reach: closed })
    const plan = await planDatabaseMigration(h.deps, JOB)
    expect(plan.blocked).toBe(true)
    expect(plan.steps).toEqual([])
    expect(h.calls).toEqual([])
  })
})
