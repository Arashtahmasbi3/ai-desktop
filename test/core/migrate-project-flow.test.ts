import { describe, expect, it } from 'vitest'
import type { PortFact, ReachabilityReport } from '../../src/shared/vps'
import type {
  MigrationExecOutcome,
  MigrationJob,
  MigrationPlan
} from '../../src/shared/migration'
import {
  DEFAULT_MIGRATION_EXCLUDES,
  type MigrationFlowDeps,
  chooseMode,
  describeMigrationPlan,
  formatArgv,
  preflightMigration
} from '../../src/core/tools/migrate-project-flow'
import { runMigration } from '../../src/core/tools/migrate-project-run'
import type { AuditEntry } from '../../src/core/agent/audit-log'

/**
 * S4.2 / S4.5 / S4.6 — the migration flow.
 *
 * Fixtures are the real acceptance case: `/opt/zoonestore` on `spmotor` (91.107.174.210) moving to
 * `yoserver-spmotor` (212.16.86.23), where `source → target:22` is filtered and only
 * `this computer → target:22` is open. No test here runs rsync, ssh or a socket: every command is
 * handed to an injected runner and asserted as the exact argv / command string.
 */

const JOB: MigrationJob = {
  source: {
    serverId: 'srv-spmotor',
    name: 'spmotor',
    host: '91.107.174.210',
    port: 22,
    username: 'root',
    path: '/opt/zoonestore'
  },
  target: {
    serverId: 'srv-yoserver',
    name: 'yoserver-spmotor',
    host: '212.16.86.23',
    port: 22,
    username: 'root',
    path: '/opt/zoonestore'
  },
  excludes: [...DEFAULT_MIGRATION_EXCLUDES]
}

const LOCAL_STAGING = '/var/tmp/ai-desktop-migrate/212.16.86.23'
const SSH_OPTS = '-p 22 -o BatchMode=yes -o StrictHostKeyChecking=accept-new'

const BASELINE = 'files=1204 dirs=88 bytes=6400000000\ntop=.env apps package.json'
const DIGEST = 'a'.repeat(64)
const OK: MigrationExecOutcome = { ok: true, stdout: '', stderr: '', exitCode: 0 }

const VERSIONS = [
  'nginx=nginx version: nginx/1.24.0',
  'node=v20.11.1',
  'docker=Docker version 27.0.3, build 7d4bcd8',
  'postgres=psql (PostgreSQL) 16.3'
].join('\n')

function fact(from: PortFact['from'], open: boolean | null, detail?: string): PortFact {
  return { from, open, at: 1_700_000_000_000, ...(detail === undefined ? {} : { detail }) }
}

function report(over: Partial<ReachabilityReport> = {}): ReachabilityReport {
  return {
    host: '212.16.86.23',
    port: 22,
    source: fact('source', false, 'timed out'),
    local: fact('local', true, 'tcp handshake'),
    target: fact('target', null, 'no session to the target'),
    agreement: 'local-only',
    summary: '212.16.86.23:22 is open from this computer and closed from spmotor.',
    nextSteps: [],
    ...over
  }
}

interface Script {
  report?: ReachabilityReport
  /** Answer for the `find . -mindepth 1` baseline; `target` is the destination side. */
  baseline?: (side: 'source' | 'target') => string
  /** Answer for the sampled sha256 digest; `target` is the destination side. */
  digest?: (side: 'source' | 'target') => string
  /** Free-space line reported by `df -Pk`; `side` says which machine answered. */
  disk?: (side: 'source' | 'target') => string
  /** Version banners; `side` says which machine answered. */
  versions?: (side: 'source' | 'target') => string
  /** KB the source tree occupies after the excludes (`du -sk --exclude=`). */
  estimateKb?: number
  /** Answer for the staging probe, e.g. `none` or `5242880`. */
  staging?: string
  /** Does the destination path already exist? */
  targetExists?: 'yes' | 'no'
  /** Overrides for individual commands, matched on a substring of the assembled command. */
  responses?: Array<{ match: string; outcome: Partial<MigrationExecOutcome> }>
  /** Called when a transfer rsync is about to run (used to cancel mid-flight). */
  onTransfer?: () => void
  localFreeBytes?: number | undefined
}

interface FakeFlow extends MigrationFlowDeps {
  sourceCommands: string[]
  localArgv: string[][]
  audits: Array<Omit<AuditEntry, 'at'>>
}

/** Which side of the transfer a command belongs to: anything wrapped in ssh runs on the target. */
function sideOf(command: string): 'source' | 'target' {
  return command.trimStart().startsWith('ssh ') ? 'target' : 'source'
}

function scriptedDeps(script: Script = {}): FakeFlow {
  const sourceCommands: string[] = []
  const localArgv: string[][] = []
  const audits: Array<Omit<AuditEntry, 'at'>> = []

  const answer = (command: string): MigrationExecOutcome => {
    for (const entry of script.responses ?? []) {
      if (command.includes(entry.match)) return { ...OK, ...entry.outcome }
    }
    const side = sideOf(command)
    if (command.includes('du -sk --exclude')) {
      return { ...OK, stdout: `${script.estimateKb ?? 6_000_000}\t/opt/zoonestore\n` }
    }
    if (command.includes('find . -mindepth 1') && !command.includes('NR % ')) {
      return { ...OK, stdout: script.baseline?.(side) ?? BASELINE }
    }
    if (command.includes('NR % ')) {
      return { ...OK, stdout: `${script.digest?.(side) ?? DIGEST}  -\n` }
    }
    if (command.includes('df -Pk')) {
      const stdout =
        script.disk?.(side) ??
        (side === 'target'
          ? '/dev/sdb1 80000000 10000000 70000000 13% /'
          : '/dev/sda1 38000000 32000000 4100000 89% /')
      return { ...OK, stdout }
    }
    if (command.includes('du -sk') && command.includes('echo none')) {
      return { ...OK, stdout: `${script.staging ?? 'none'}\n` }
    }
    if (command.includes('test -e ')) return { ...OK, stdout: `${script.targetExists ?? 'no'}\n` }
    if (command.includes('test -d ')) return { ...OK, stdout: 'yes\n' }
    if (command.includes('rsync --version')) {
      return { ...OK, stdout: 'rsync  version 3.2.7  protocol version 31\n' }
    }
    if (command.includes('command -v rsync')) return { ...OK, stdout: '/usr/bin/rsync\n' }
    if (command.includes('nginx=')) return { ...OK, stdout: script.versions?.(side) ?? VERSIONS }
    if (/\bmv -T\b/.test(command)) return { ...OK, stdout: '' }
    if (/mkdir -p/.test(command)) return { ...OK, stdout: '' }
    if (/\brsync\b/.test(command)) return { ...OK, stdout: 'sent 6,400,000,000 bytes\n' }
    if (/(^|\s)'?true'?(\s|$)/.test(command)) return { ...OK, stdout: '' }
    return OK
  }

  return {
    sourceCommands,
    localArgv,
    audits,
    localStagingDir: LOCAL_STAGING,
    execOnSource: async (command) => {
      sourceCommands.push(command)
      return answer(command)
    },
    execLocal: async (argv) => {
      localArgv.push([...argv])
      const command = formatArgv([...argv])
      if (argv[0] === 'rsync' && !command.includes('--version')) script.onTransfer?.()
      return answer(command)
    },
    localFreeBytes: async () => script.localFreeBytes ?? 200_000_000_000,
    reachability: async () => script.report ?? report(),
    audit: async (entry) => {
      audits.push(entry)
    }
  }
}

function factOf(plan: MigrationPlan, id: string): MigrationPlan['facts'][number] {
  const found = plan.facts.find((entry) => entry.id === id)
  if (found === undefined) throw new Error(`no fact ${id} in ${plan.facts.map((f) => f.id).join(', ')}`)
  return found
}

function stepOf(plan: MigrationPlan, id: MigrationPlan['steps'][number]['id']): MigrationPlan['steps'][number] {
  const step = plan.steps.find((entry) => entry.id === id)
  if (step === undefined) throw new Error(`no step ${id} in ${plan.steps.map((s) => s.id).join(', ')}`)
  return step
}

function executed(deps: FakeFlow): string {
  return [...deps.sourceCommands, ...deps.localArgv.map((argv) => formatArgv(argv))].join('\n')
}

describe('chooseMode (S4.2)', () => {
  it('chooses direct when the source can reach the target port', () => {
    const decision = chooseMode(report({ source: fact('source', true), agreement: 'all-open' }))
    expect(decision.mode).toBe('direct')
    expect(decision.blocked).toBe(false)
    expect(decision.reason).toMatch(/direct/i)
  })

  it('chooses relay for the reported case: filtered from the source, open from this computer', () => {
    const decision = chooseMode(report())
    expect(decision.mode).toBe('relay')
    expect(decision.blocked).toBe(false)
    expect(decision.reason).toMatch(/this computer/)
  })

  it('still prefers direct when both paths are open, and says so', () => {
    const decision = chooseMode(report({ source: fact('source', true), agreement: 'all-open' }))
    expect(decision.mode).toBe('direct')
    expect(decision.reason).toMatch(/both/i)
  })

  it('chooses relay when the source path was never observed but this computer reaches the port', () => {
    const decision = chooseMode(report({ source: fact('source', null), agreement: 'unobserved' }))
    expect(decision.mode).toBe('relay')
    expect(decision.reason).toMatch(/not tested|not observed/i)
  })

  it('reports no usable path instead of guessing when neither path is open', () => {
    const decision = chooseMode(
      report({
        source: fact('source', false, 'timed out'),
        local: fact('local', false, 'refused'),
        agreement: 'all-closed'
      })
    )
    expect(decision.mode).toBeUndefined()
    expect(decision.blocked).toBe(true)
  })
})

describe('preflightMigration facts (S4.3)', () => {
  it('shows the mode, the space estimate and the excludes in the plan', async () => {
    const plan = await preflightMigration(scriptedDeps(), JOB)

    expect(plan.mode).toBe('relay')
    expect(plan.blocked).toBe(false)
    expect(plan.excludes).toEqual([...DEFAULT_MIGRATION_EXCLUDES])
    expect(plan.estimateBytes).toBe(6_000_000 * 1024)
    expect(factOf(plan, 'target-space').status).toBe('pass')
    expect(factOf(plan, 'target-space').value).toMatch(/free/)
  })

  it('warns, without refusing, when the source is 89% full', async () => {
    const plan = await preflightMigration(scriptedDeps(), JOB)
    const filled = factOf(plan, 'source-fill')
    expect(filled.status).toBe('warn')
    expect(filled.value).toContain('89')
    expect(plan.blocked).toBe(false)
  })

  it('refuses to start when the destination has less free space than the estimate', async () => {
    const plan = await preflightMigration(
      scriptedDeps({ disk: () => '/dev/sdb1 80000000 79900000 100000 99% /' }),
      JOB
    )
    expect(factOf(plan, 'target-space').status).toBe('fail')
    expect(plan.blocked).toBe(true)
  })

  it('refuses when this computer cannot authenticate to the target with a key', async () => {
    const plan = await preflightMigration(
      scriptedDeps({
        responses: [
          { match: 'root@212.16.86.23 true', outcome: { ok: false, exitCode: 255 } }
        ]
      }),
      JOB
    )
    expect(factOf(plan, 'key-runner-target').status).toBe('fail')
    expect(plan.blocked).toBe(true)
  })

  it('also requires key access from this computer to the source in relay mode', async () => {
    const deps = scriptedDeps()
    const plan = await preflightMigration(deps, JOB)
    expect(factOf(plan, 'key-local-source').status).toBe('pass')
    expect(
      deps.localArgv.some(
        (argv) => argv[0] === 'ssh' && argv.includes('root@91.107.174.210') && argv.includes('true')
      )
    ).toBe(true)
  })

  it('does not need key access from here to the source in direct mode', async () => {
    const plan = await preflightMigration(
      scriptedDeps({ report: report({ source: fact('source', true) }) }),
      JOB
    )
    expect(plan.mode).toBe('direct')
    expect(plan.facts.some((entry) => entry.id === 'key-local-source')).toBe(false)
  })

  it('refuses when rsync is missing on the machine that would run it', async () => {
    const plan = await preflightMigration(
      scriptedDeps({
        responses: [
          { match: 'rsync --version', outcome: { ok: false, exitCode: 127, stderr: 'not found' } }
        ]
      }),
      JOB
    )
    expect(factOf(plan, 'rsync-runner').status).toBe('fail')
    expect(plan.blocked).toBe(true)
  })

  it('refuses when rsync is missing on the target', async () => {
    const plan = await preflightMigration(
      scriptedDeps({ responses: [{ match: 'command -v rsync', outcome: { ok: false, exitCode: 1 } }] }),
      JOB
    )
    expect(factOf(plan, 'rsync-target').status).toBe('fail')
    expect(plan.blocked).toBe(true)
  })

  it('shows nginx/node/docker/postgres on both ends, and warns on a version skew', async () => {
    const plan = await preflightMigration(
      scriptedDeps({
        versions: (side) =>
          side === 'target' ? VERSIONS.replace('nginx/1.24.0', 'nginx/1.26.0') : VERSIONS
      }),
      JOB
    )
    const nginx = factOf(plan, 'version-nginx')
    expect(nginx.status).toBe('warn')
    expect(nginx.value).toContain('1.24.0')
    expect(nginx.value).toContain('1.26.0')
    expect(factOf(plan, 'version-node').status).toBe('pass')
    expect(plan.blocked).toBe(false)
  })

  it('refuses a destination directory that already exists', async () => {
    const plan = await preflightMigration(scriptedDeps({ targetExists: 'yes' }), JOB)
    expect(factOf(plan, 'path-target').status).toBe('fail')
    expect(plan.blocked).toBe(true)
  })

  it('refuses a sensitive or relative source path without running anything', async () => {
    for (const path of ['/etc', '/var/log', 'relative/path', '/opt/x; rm -rf /']) {
      const deps = scriptedDeps()
      const plan = await preflightMigration(deps, { ...JOB, source: { ...JOB.source, path } })
      expect(plan.blocked, path).toBe(true)
      expect(plan.steps, path).toEqual([])
      expect(
        deps.sourceCommands.filter((command) => command.includes('rsync')),
        path
      ).toEqual([])
    }
  })
})

describe('the exact commands (S4.4)', () => {
  it('shows the direct rsync command with the excludes before anything runs', async () => {
    const plan = await preflightMigration(
      scriptedDeps({ report: report({ source: fact('source', true) }) }),
      JOB
    )
    expect(stepOf(plan, 'transfer').command).toBe(
      'rsync -az --info=stats2 --partial --exclude=node_modules --exclude=.next ' +
        '--exclude=builds --exclude=artifacts --exclude=backups ' +
        `-e 'ssh ${SSH_OPTS}' /opt/zoonestore/ root@212.16.86.23:/opt/zoonestore.migrating/`
    )
  })

  it('shows both relay legs, each going through this computer', async () => {
    const plan = await preflightMigration(scriptedDeps(), JOB)
    expect(stepOf(plan, 'pull').command).toContain('root@91.107.174.210:/opt/zoonestore/')
    expect(stepOf(plan, 'pull').command).toContain(`${LOCAL_STAGING}/zoonestore/`)
    expect(stepOf(plan, 'push').command).toContain('root@212.16.86.23:/opt/zoonestore.migrating/')
    expect(stepOf(plan, 'push').command).toContain(`${LOCAL_STAGING}/zoonestore/`)
    expect(plan.steps.map((step) => step.runner)).toEqual([
      'source',
      'local',
      'local',
      'source',
      'local',
      'local'
    ])
  })

  it('never writes to the destination before the commit', async () => {
    const plan = await preflightMigration(scriptedDeps(), JOB)
    for (const step of plan.steps) {
      if (step.id === 'commit') continue
      expect(step.command).not.toMatch(/rsync[^\n]*212\.16\.86\.23:\/opt\/zoonestore\//)
    }
  })
})

describe('runMigration — direct mode (S4.2/S4.5)', () => {
  it('transfers from the source, verifies, then renames the staging directory', async () => {
    const deps = scriptedDeps({ report: report({ source: fact('source', true) }) })
    const run = await runMigration(deps, JOB)

    expect(run.ok, run.message).toBe(true)
    expect(run.mode).toBe('direct')
    expect(run.cancelled).toBe(false)
    expect(run.verification?.files).toBe(1204)
    expect(run.verification?.dirs).toBe(88)
    expect(run.committedTo).toBe('/opt/zoonestore')
    expect(deps.localArgv.filter((argv) => argv[0] === 'rsync')).toEqual([])

    expect(deps.sourceCommands.find((command) => command.includes('--exclude=node_modules'))).toBe(
      'rsync -az --info=stats2 --partial --exclude=node_modules --exclude=.next ' +
        '--exclude=builds --exclude=artifacts --exclude=backups ' +
        `-e 'ssh ${SSH_OPTS}' /opt/zoonestore/ root@212.16.86.23:/opt/zoonestore.migrating/`
    )
    expect(deps.sourceCommands.find((command) => command.includes('mv -T'))).toBe(
      `ssh ${SSH_OPTS} root@212.16.86.23 'mv -T /opt/zoonestore.migrating /opt/zoonestore'`
    )
    expect(executed(deps)).not.toContain('--delete')
  })

  it('refuses to run when preflight fails, and moves no byte', async () => {
    const deps = scriptedDeps({
      report: report({ source: fact('source', true) }),
      targetExists: 'yes'
    })
    const run = await runMigration(deps, JOB)
    expect(run.ok).toBe(false)
    expect(run.cancelled).toBe(false)
    expect(
      deps.sourceCommands.filter((command) => command.startsWith('rsync ') && !command.includes('--version'))
    ).toEqual([])
    expect(run.message).toMatch(/preflight/i)
  })
})

describe('runMigration — relay mode, the reported case (S4.2)', () => {
  it('runs both legs on this computer and asserts the exact argv', async () => {
    const deps = scriptedDeps()
    const run = await runMigration(deps, JOB)

    expect(run.ok, run.message).toBe(true)
    expect(run.mode).toBe('relay')

    const excludes = DEFAULT_MIGRATION_EXCLUDES.flatMap((name) => [`--exclude=${name}`])
    expect(deps.localArgv).toContainEqual([
      'rsync',
      '-az',
      '--info=stats2',
      '--partial',
      ...excludes,
      '-e',
      `ssh ${SSH_OPTS}`,
      'root@91.107.174.210:/opt/zoonestore/',
      `${LOCAL_STAGING}/zoonestore/`
    ])
    expect(deps.localArgv).toContainEqual([
      'rsync',
      '-az',
      '--info=stats2',
      '--partial',
      ...excludes,
      '-e',
      `ssh ${SSH_OPTS}`,
      `${LOCAL_STAGING}/zoonestore/`,
      'root@212.16.86.23:/opt/zoonestore.migrating/'
    ])
    // Nothing is transferred from the source server: that path is filtered.
    expect(deps.sourceCommands.filter((command) => command.startsWith('rsync '))).toEqual([])
    expect(deps.localArgv).toContainEqual([
      'ssh',
      '-p',
      '22',
      '-o',
      'BatchMode=yes',
      '-o',
      'StrictHostKeyChecking=accept-new',
      'root@212.16.86.23',
      'mv -T /opt/zoonestore.migrating /opt/zoonestore'
    ])
  })

  it('reads the relay plan as facts, then one line per leg', async () => {
    const plan = await preflightMigration(scriptedDeps(), JOB)
    const text = describeMigrationPlan(plan, JOB)
    expect(text).toMatch(/relay/i)
    expect(text).toContain('--exclude=node_modules')
    expect(text).toMatch(/nginx/i)
    expect(text).toContain('PASS')
    expect(text).toContain('WARN')
  })

  it('prints a FAIL mark and the blocking reason when the plan is refused', async () => {
    const plan = await preflightMigration(
      scriptedDeps({ disk: () => '/dev/sdb1 80000000 79900000 100000 99% /' }),
      JOB
    )
    const text = describeMigrationPlan(plan, JOB)
    expect(text).toContain('FAIL')
    expect(text).toMatch(/not enough free space/i)
  })
})

describe('runMigration — verification is a hard failure (S4.5)', () => {
  it('fails loudly and does not commit when the file count differs', async () => {
    const deps = scriptedDeps({
      baseline: (side) =>
        side === 'target'
          ? 'files=1203 dirs=88 bytes=6400000000\ntop=.env apps package.json'
          : BASELINE
    })
    const run = await runMigration(deps, JOB)

    expect(run.ok).toBe(false)
    expect(run.committedTo).toBeUndefined()
    expect(run.verification?.ok).toBe(false)
    expect(run.message).toMatch(/mismatch/i)
    expect(run.message).toContain('1204')
    expect(run.message).toContain('1203')
    expect(executed(deps)).not.toContain('mv -T')
    expect(deps.audits.at(-1)?.ok).toBe(false)
  })

  it('fails loudly when the top-level entries differ', async () => {
    const deps = scriptedDeps({
      baseline: (side) =>
        side === 'target'
          ? 'files=1204 dirs=88 bytes=6400000000\ntop=.env apps package.json node_modules'
          : BASELINE
    })
    const run = await runMigration(deps, JOB)
    expect(run.ok).toBe(false)
    expect(run.message).toMatch(/top-level/i)
    expect(executed(deps)).not.toContain('mv -T')
  })

  it('fails loudly when the sampled checksum differs', async () => {
    const deps = scriptedDeps({ digest: (side) => (side === 'target' ? 'b'.repeat(64) : DIGEST) })
    const run = await runMigration(deps, JOB)
    expect(run.ok).toBe(false)
    expect(run.message).toMatch(/checksum/i)
    expect(run.committedTo).toBeUndefined()
  })

  it('commits only after the numbers and the sample agree', async () => {
    const deps = scriptedDeps()
    const run = await runMigration(deps, JOB)
    const commitIndex = deps.localArgv.findIndex((argv) =>
      argv.includes('mv -T /opt/zoonestore.migrating /opt/zoonestore')
    )
    const verifyIndex = deps.localArgv.findIndex((argv) => formatArgv(argv).includes('NR % '))
    expect(commitIndex).toBeGreaterThan(verifyIndex)
    expect(run.verification?.sampleDigest).toBe(DIGEST)
  })
})

describe('runMigration — progress, cancel, resume (S4.6)', () => {
  it('reports the phases in order, ending at 100%', async () => {
    const deps = scriptedDeps()
    const events: string[] = []
    let lastPercent = -1
    let monotonic = true
    const run = await runMigration(deps, JOB, {
      onProgress: (event) => {
        events.push(event.phase)
        if (event.percent < lastPercent) monotonic = false
        lastPercent = event.percent
      }
    })
    expect(run.ok, run.message).toBe(true)
    expect(monotonic).toBe(true)
    expect(events[0]).toBe('preflight')
    expect(events).toContain('baseline')
    expect(events).toContain('pull')
    expect(events).toContain('push')
    expect(events).toContain('verify')
    expect(events).toContain('commit')
    expect(events.at(-1)).toBe('done')
    expect(lastPercent).toBe(100)
  })

  it('cancels mid-transfer without committing, and keeps the staging directory for a resume', async () => {
    const controller = new AbortController()
    const deps = scriptedDeps({ onTransfer: () => controller.abort() })
    const run = await runMigration(deps, JOB, { signal: controller.signal })

    expect(run.ok).toBe(false)
    expect(run.cancelled).toBe(true)
    expect(run.committedTo).toBeUndefined()
    expect(run.stagingPath).toBe('/opt/zoonestore.migrating')
    expect(run.message).toContain('/opt/zoonestore.migrating')
    expect(run.message).toMatch(/resume/i)
    expect(executed(deps)).not.toContain('mv -T')
  })

  it('does nothing at all when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const deps = scriptedDeps()
    const run = await runMigration(deps, JOB, { signal: controller.signal })
    expect(run.cancelled).toBe(true)
    expect(
      deps.sourceCommands.filter((command) => command.startsWith('rsync ') && !command.includes('--version'))
    ).toEqual([])
    expect(deps.localArgv.filter((argv) => argv[0] === 'rsync')).toEqual([])
  })

  it('reuses an existing staging directory and only needs the space still missing', async () => {
    const deps = scriptedDeps({ staging: '2000000' })
    const plan = await preflightMigration(deps, JOB)

    expect(plan.resume).toBe(true)
    expect(plan.stagedBytes).toBe(2_000_000 * 1024)
    expect(factOf(plan, 'staging').value).toMatch(/resume/i)
    // 6,000,000 KB estimated, 2,000,000 KB already staged: only 4,000,000 KB are still needed.
    expect(factOf(plan, 'target-space').value).toContain('3.8 GB')
  })

  it('keeps the staging directory when the transfer exits non-zero, and names the resume', async () => {
    const deps = scriptedDeps({
      responses: [
        { match: 'rsync -az', outcome: { ok: false, exitCode: 23, stderr: 'rsync error: vanished' } }
      ]
    })
    const run = await runMigration(deps, JOB)
    expect(run.ok).toBe(false)
    expect(run.cancelled).toBe(false)
    expect(run.message).toContain('23')
    expect(run.message).toMatch(/resume/i)
    expect(run.stagingPath).toBe('/opt/zoonestore.migrating')
  })

  it('audits the run, and the audit names the servers rather than raw ids', async () => {
    const deps = scriptedDeps()
    await runMigration(deps, JOB)
    expect(deps.audits).toHaveLength(1)
    expect(deps.audits[0]?.command).toContain('/opt/zoonestore')
    expect(deps.audits[0]?.command).toContain('yoserver-spmotor')
    expect(deps.audits[0]?.ok).toBe(true)
  })
})
