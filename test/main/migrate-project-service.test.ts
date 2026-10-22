import { describe, expect, it } from 'vitest'
import type { ReachabilityReport, PortFact, VpsExecResult } from '../../src/shared/vps'
import type { MigrationExecOutcome, MigrationRequest } from '../../src/shared/migration'
import { formatArgv } from '../../src/core/tools/migrate-argv'
import {
  cancelActiveMigration,
  createMigrationFlowDeps,
  preflightMigrationRequest,
  resolveMigrationJob,
  runMigrationRequest,
  type MigrationServiceOptions,
  type MigrationSshHost
} from '../../src/main/migrate-project-service'

/**
 * The main-process wiring, and the proof that a unit test never runs the transfer.
 *
 * `@core` decides *what* to run; this module decides *where*: the app's own SSH session for the
 * source server, and `execFile(argv)` for this computer. Both are injected here, so the assertions
 * are about which machine received which command — not about a byte moving.
 */

const SERVERS = {
  'srv-spmotor': { host: '91.107.174.210', port: 22, username: 'root' },
  'srv-yoserver': { host: '212.16.86.23', port: 22, username: 'root' }
}

const NAMES = { 'srv-spmotor': 'spmotor', 'srv-yoserver': 'yoserver-spmotor' }

const REQUEST: MigrationRequest = {
  sourceServerId: 'srv-spmotor',
  sourcePath: '/opt/zoonestore',
  targetServerId: 'srv-yoserver',
  targetPath: '/opt/zoonestore'
}

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

interface Fake {
  commands: Array<{ serverId: string; command: string }>
  localArgv: string[][]
  audits: string[]
}

/** A plausible answer for every probe the flow can send, so the fake is not a yes-machine. */
function scriptedAnswer(command: string): Partial<VpsExecResult> {
  if (command.includes('du -sk --exclude')) return { stdout: '6000000\t/opt/zoonestore\n' }
  if (command.includes('NR % ')) return { stdout: `${'a'.repeat(64)}  -\n` }
  if (command.includes('find . -mindepth 1')) {
    return { stdout: 'files=1204 dirs=88 bytes=6400000000\ntop=.env apps package.json\n' }
  }
  if (command.includes('df -Pk')) return { stdout: '/dev/sdb1 80000000 10000000 70000000 13% /\n' }
  if (command.includes('du -sk') && command.includes('echo none')) return { stdout: 'none\n' }
  if (command.includes('test -e ')) return { stdout: 'no\n' }
  if (command.includes('test -d ')) return { stdout: 'yes\n' }
  if (command.includes('rsync --version')) return { stdout: 'rsync  version 3.2.7  protocol version 31\n' }
  if (command.includes('command -v rsync')) return { stdout: '/usr/bin/rsync\n' }
  if (command.includes('nginx=')) {
    return {
      stdout: [
        'nginx=nginx version: nginx/1.24.0',
        'node=v20.11.1',
        'docker=Docker version 27.0.3, build 7d4bcd8',
        'postgres=psql (PostgreSQL) 16.3'
      ].join('\n')
    }
  }
  return { stdout: '' }
}

function fakeHost(
  fake: Fake,
  options: { connected?: string[]; answer?: (command: string) => Partial<VpsExecResult> } = {}
): MigrationSshHost {
  const connected = options.connected ?? ['srv-spmotor']
  const answer = options.answer ?? scriptedAnswer
  return {
    connectedServers: () => connected,
    resolveServer: async (id) => SERVERS[id as keyof typeof SERVERS],
    listServers: async () => Object.entries(NAMES).map(([id, name]) => ({ id, name })),
    exec: async (serverId, command) => {
      fake.commands.push({ serverId, command })
      return { ok: true, stdout: '', stderr: '', exitCode: 0, ...answer(command) }
    }
  }
}

function serviceOptions(
  fake: Fake,
  overrides: Partial<MigrationServiceOptions> = {}
): MigrationServiceOptions {
  return {
    host: fakeHost(fake),
    local: async (argv) => {
      fake.localArgv.push([...argv])
      return { ok: true, stdout: '', stderr: '', exitCode: 0, ...scriptedAnswer(formatArgv(argv)) }
    },
    localFreeBytes: async () => 200_000_000_000,
    localStagingDir: '/var/tmp/ai-desktop-migrate/212.16.86.23',
    reachability: async () => relayReport(),
    serverName: async (id) => NAMES[id as keyof typeof NAMES],
    audit: async (entry) => {
      fake.audits.push(`${entry.ok}:${entry.command ?? ''}`)
    },
    ...overrides
  }
}

function newFake(): Fake {
  return { commands: [], localArgv: [], audits: [] }
}

describe('resolveMigrationJob', () => {
  it('resolves both saved servers to endpoints, keeping the paths as typed', async () => {
    const options = serviceOptions(newFake())
    const { job, error } = await resolveMigrationJob(options, REQUEST)
    expect(error).toBeUndefined()
    expect(job?.source).toMatchObject({ serverId: 'srv-spmotor', host: '91.107.174.210', path: '/opt/zoonestore' })
    expect(job?.target).toMatchObject({ serverId: 'srv-yoserver', host: '212.16.86.23', path: '/opt/zoonestore' })
    expect(job?.source.name).toBe('spmotor')
  })

  it('refuses a disconnected source and names it instead of printing an id', async () => {
    const fake = newFake()
    const options = serviceOptions(fake, { host: fakeHost(fake, { connected: [] }) })
    const { job, error } = await resolveMigrationJob(options, REQUEST)
    expect(job).toBeUndefined()
    expect(error).toMatch(/spmotor/)
    expect(error).not.toMatch(/srv-spmotor/)
  })

  it('refuses an unknown target server', async () => {
    const options = serviceOptions(newFake())
    const { error } = await resolveMigrationJob(options, { ...REQUEST, targetServerId: 'srv-ghost' })
    expect(error).toMatch(/unknown/i)
  })
})

describe('createMigrationFlowDeps', () => {
  it('sends source commands to the app session for the source server only', async () => {
    const fake = newFake()
    const options = serviceOptions(fake)
    const deps = createMigrationFlowDeps(options, { sourceServerId: 'srv-spmotor' })
    const outcome = await deps.execOnSource("test -d '/opt/zoonestore'")
    expect(outcome.ok).toBe(true)
    expect(fake.commands).toEqual([
      { serverId: 'srv-spmotor', command: "test -d '/opt/zoonestore'" }
    ])
    expect(fake.localArgv).toEqual([])
  })

  it('runs this computer’s commands as an exact argv, never through a shell', async () => {
    const fake = newFake()
    const options = serviceOptions(fake)
    const deps = createMigrationFlowDeps(options, { sourceServerId: 'srv-spmotor' })
    await deps.execLocal(['rsync', '--version'])
    expect(fake.localArgv).toEqual([['rsync', '--version']])
  })

  it('maps a policy block to a non-ok outcome instead of throwing', async () => {
    const fake = newFake()
    const options = serviceOptions(fake, {
      host: fakeHost(fake, { answer: () => ({ ok: false, blocked: true, reason: 'read-only host' }) })
    })
    const deps = createMigrationFlowDeps(options, { sourceServerId: 'srv-spmotor' })
    const outcome: MigrationExecOutcome = await deps.execOnSource('rsync --version')
    expect(outcome.ok).toBe(false)
    expect(outcome.blocked).toBe(true)
  })
})

describe('preflightMigrationRequest', () => {
  it('probes from the right machine and moves nothing', async () => {
    const fake = newFake()
    const options = serviceOptions(fake)
    const plan = await preflightMigrationRequest(options, REQUEST)

    expect(plan.mode).toBe('relay')
    expect(plan.blocked).toBe(false)
    // The source-side facts come over the app's session…
    expect(fake.commands.some((entry) => entry.serverId === 'srv-spmotor' && entry.command.includes('df -Pk'))).toBe(
      true
    )
    // …and every target-side fact is an ssh command run on this computer.
    expect(
      fake.commands.some(
        (entry) =>
          entry.serverId === 'srv-spmotor' &&
          entry.command.startsWith('ssh ') &&
          entry.command.includes('root@212.16.86.23')
      )
    ).toBe(false)
    expect(fake.localArgv.some((argv) => argv[0] === 'ssh' && argv.includes('root@212.16.86.23'))).toBe(true)
    // No transfer during preflight.
    expect(fake.localArgv.some((argv) => argv[0] === 'rsync' && !argv.includes('--version'))).toBe(false)
    expect(fake.commands.some((entry) => entry.command.startsWith('rsync '))).toBe(false)
  })

  it('reports a missing source session as a message, not a crash', async () => {
    const fake = newFake()
    const options = serviceOptions(fake, { host: fakeHost(fake, { connected: [] }) })
    const plan = await preflightMigrationRequest(options, REQUEST)
    expect(plan.blocked).toBe(true)
    expect(plan.facts[0]?.value).toMatch(/spmotor/)
    expect(fake.commands).toEqual([])
  })
})

describe('runMigrationRequest', () => {
  it('can be cancelled while the transfer is in flight', async () => {
    const fake = newFake()
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let started: () => void = () => undefined
    const transferStarted = new Promise<void>((resolve) => {
      started = resolve
    })

    const options = serviceOptions(fake, {
      local: async (argv) => {
        fake.localArgv.push([...argv])
        if (argv[0] === 'rsync' && !argv.includes('--version')) {
          started()
          await gate
        }
        return { ok: true, stdout: '', stderr: '', exitCode: 0, ...scriptedAnswer(formatArgv(argv)) }
      }
    })

    const running = runMigrationRequest(options, REQUEST)
    await transferStarted
    expect(cancelActiveMigration()).toBe(true)
    release()
    const run = await running

    expect(run.cancelled).toBe(true)
    expect(run.ok).toBe(false)
    expect(fake.localArgv.some((argv) => argv.includes('mv -T /opt/zoonestore.migrating /opt/zoonestore'))).toBe(
      false
    )
  })

  it('writes one audit entry per run', async () => {
    const fake = newFake()
    const run = await runMigrationRequest(serviceOptions(fake), REQUEST)
    expect(run.ok).toBe(true)
    expect(fake.audits).toHaveLength(1)
    expect(fake.audits[0]?.startsWith('true:')).toBe(true)
    expect(fake.audits[0]).toContain('yoserver-spmotor')
  })
})
