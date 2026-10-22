import { describe, expect, it } from 'vitest'
import type { DatabaseRequest } from '../../src/shared/database-migration'
import type { BringUpRequest } from '../../src/shared/bring-up'
import type { MigrationExecOutcome } from '../../src/shared/migration'
import type { PortFact, ReachabilityReport, VpsExecResult } from '../../src/shared/vps'
import { formatArgv } from '../../src/core/tools/migrate-argv'
import type { MigrationSshHost } from '../../src/main/migrate-project-service'
import {
  cancelActiveBringUp,
  cancelActiveDatabaseMigration,
  planBringUpRequest,
  preflightDatabaseRequest,
  resolveBringUpJob,
  resolveDatabaseJob,
  runBringUpRequest,
  runDatabaseMigrationRequest,
  type S5ServiceOptions
} from '../../src/main/bring-up-service'

/**
 * S5 — the main-process wiring for the database migration and the target bring-up.
 *
 * `@core` decides every command; this module only says *where* it runs: the source server through
 * the app's own SSH session (so the host policy, deny list, rate limiter and audit still apply),
 * the target over ssh, and this computer as an exact argv. All three are injected, so no test runs
 * docker, psql, nginx, certbot or a socket.
 */

const SERVERS: Record<string, { host: string; port: number; username: string }> = {
  'srv-spmotor': { host: '91.107.174.210', port: 22, username: 'root' },
  'srv-yoserver': { host: '212.16.86.23', port: 22, username: 'root' }
}

const NAMES: Record<string, string> = {
  'srv-spmotor': 'spmotor',
  'srv-yoserver': 'yoserver-spmotor'
}

const DB_REQUEST: DatabaseRequest = {
  sourceServerId: 'srv-spmotor',
  targetServerId: 'srv-yoserver',
  container: 'zoonestore-postgres',
  database: 'zoonestore'
}

const BRING_UP_REQUEST: BringUpRequest = {
  sourceServerId: 'srv-spmotor',
  targetServerId: 'srv-yoserver',
  projectPath: '/opt/zoonestore',
  domains: ['goldenmode2.com', 'zoonestore.ir'],
  certbotEmail: 'ops@goldenmode2.com'
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

function scriptedAnswer(command: string): Partial<VpsExecResult> {
  if (command.includes('{{.State.Running}}')) return { stdout: 'true\n' }
  if (command.includes('pg_database_size')) return { stdout: '4800000000\n' }
  if (command.includes('tables=%s')) return { stdout: 'tables=37\nrows=accounts=1204\nusers=88\n' }
  if (command.includes('sha256=') && command.includes('[ -f ')) return { stdout: 'none\n' }
  if (command.includes('sha256=')) return { stdout: `sha256=${'a'.repeat(64)}\nbytes=524288000\n` }
  if (command.includes('sed -n')) return { stdout: 'DATABASE_URL\nNODE_ENV\n' }
  if (command.includes('test -f') && command.includes('.env')) return { stdout: 'yes\n' }
  if (command.includes('pm2 jlist')) {
    return {
      stdout: JSON.stringify([
        { name: 'zoonestore-api', pm2_env: { status: 'online' } },
        { name: 'zoonestore-web', pm2_env: { status: 'online' } }
      ])
    }
  }
  if (command.includes('nginx -t')) return { stdout: 'nginx: configuration file test is successful\n' }
  if (command.includes('fullchain.pem')) return { stdout: 'yes\n' }
  if (command.includes('curl ')) return { stdout: '200\n' }
  return { stdout: '' }
}

function fakeHost(fake: Fake, options: { connected?: string[] } = {}): MigrationSshHost {
  const connected = options.connected ?? ['srv-spmotor']
  return {
    connectedServers: () => connected,
    resolveServer: async (id) => SERVERS[id],
    listServers: async () => Object.entries(NAMES).map(([id, name]) => ({ id, name })),
    exec: async (serverId, command) => {
      fake.commands.push({ serverId, command })
      return { ok: true, stdout: '', stderr: '', exitCode: 0, ...scriptedAnswer(command) }
    }
  }
}

function options(fake: Fake, overrides: Partial<S5ServiceOptions> = {}): S5ServiceOptions {
  return {
    host: fakeHost(fake),
    local: async (argv) => {
      fake.localArgv.push([...argv])
      const answer = scriptedAnswer(formatArgv(argv))
      return { ok: true, stdout: '', stderr: '', exitCode: 0, ...answer } as MigrationExecOutcome
    },
    localFreeBytes: async () => 200_000_000_000,
    localStagingDir: '/var/tmp/ai-desktop-migrate/212.16.86.23',
    reachability: async () => relayReport(),
    serverName: async (id) => NAMES[id],
    audit: async (entry) => {
      fake.audits.push(`${entry.ok}:${entry.command ?? ''}`)
    },
    ...overrides
  }
}

function newFake(): Fake {
  return { commands: [], localArgv: [], audits: [] }
}

const MUTATING =
  /pg_dump |pg_restore |rsync |createdb |npm ci|npm run build|pm2 start|pm2 save|ln -sfn|nginx -s reload|certbot certonly/

describe('S5.1 — resolving a database request into a job', () => {
  it('names both saved servers, and defaults the user and the dump path', async () => {
    const { job, error } = await resolveDatabaseJob(options(newFake()), DB_REQUEST)
    expect(error).toBeUndefined()
    expect(job?.source).toMatchObject({ serverId: 'srv-spmotor', host: '91.107.174.210' })
    expect(job?.target).toMatchObject({ serverId: 'srv-yoserver', host: '212.16.86.23' })
    expect(job?.user).toBe('postgres')
    expect(job?.dumpPath).toBe('/var/tmp/ai-desktop-db/zoonestore.dump')
    expect(job?.sampleTables).toBe(20)
  })

  it('refuses the same server twice, a disconnected source, and an unknown target', async () => {
    const same = await resolveDatabaseJob(options(newFake()), {
      ...DB_REQUEST,
      targetServerId: 'srv-spmotor'
    })
    expect(same.error).toMatch(/same server/i)

    const fake = newFake()
    const offline = await resolveDatabaseJob(options(fake, { host: fakeHost(fake, { connected: [] }) }), DB_REQUEST)
    expect(offline.error).toMatch(/spmotor/)
    expect(offline.error).not.toMatch(/srv-spmotor/)

    const unknown = await resolveDatabaseJob(options(newFake()), {
      ...DB_REQUEST,
      targetServerId: 'srv-ghost'
    })
    expect(unknown.error).toMatch(/unknown/i)
  })

  it('refuses a container name that could be read as a flag, without touching a machine', async () => {
    const fake = newFake()
    const { job, error } = await resolveDatabaseJob(options(fake), { ...DB_REQUEST, container: '--rm' })
    expect(job).toBeUndefined()
    expect(error).toMatch(/container/i)
    expect(fake.commands).toEqual([])
    expect(fake.localArgv).toEqual([])
  })
})

describe('S5.1 — preflight and run through the service', () => {
  it('probes the source through the app session and the target over ssh, and moves nothing', async () => {
    const fake = newFake()
    const plan = await preflightDatabaseRequest(options(fake), DB_REQUEST)

    expect(plan.dryRun).toBe(true)
    expect(plan.blocked).toBe(false)
    expect(plan.mode).toBe('relay')
    expect(fake.commands.some((entry) => entry.serverId === 'srv-spmotor' && entry.command.includes('pg_dump'))).toBe(
      false
    )
    // The target probes are an ssh argv on this computer, never a command on the source session.
    expect(
      fake.commands.some((entry) => entry.command.startsWith('ssh ') && entry.command.includes('212.16.86.23'))
    ).toBe(false)
    expect(fake.localArgv.some((argv) => argv[0] === 'ssh' && argv.includes('root@212.16.86.23'))).toBe(true)
    for (const argv of fake.localArgv) expect(formatArgv(argv)).not.toMatch(MUTATING)
  })

  it('a refused request comes back as a blocked plan with a sentence, not a thrown error', async () => {
    const fake = newFake()
    const plan = await preflightDatabaseRequest(
      options(fake, { host: fakeHost(fake, { connected: [] }) }),
      DB_REQUEST
    )
    expect(plan.blocked).toBe(true)
    expect(plan.facts[0]?.value).toMatch(/spmotor/)
    expect(fake.commands).toEqual([])
  })

  it('runs the whole migration and writes one audit entry', async () => {
    const fake = newFake()
    const run = await runDatabaseMigrationRequest(options(fake), DB_REQUEST)
    expect(run.ok).toBe(true)
    expect(fake.audits).toHaveLength(1)
    expect(fake.audits[0]?.startsWith('true:')).toBe(true)
    expect(fake.audits[0]).toContain('zoonestore')
  })

  it('can be cancelled while it is in flight, and never restores afterwards', async () => {
    const fake = newFake()
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let started: () => void = () => undefined
    const dumping = new Promise<void>((resolve) => {
      started = resolve
    })
    const base = options(fake)
    const running = runDatabaseMigrationRequest(
      {
        ...base,
        local: async (argv) => {
          const outcome = await base.local(argv)
          if (formatArgv(argv).includes('rsync ')) {
            started()
            await gate
          }
          return outcome
        }
      },
      DB_REQUEST
    )
    await dumping
    expect(cancelActiveDatabaseMigration()).toBe(true)
    release()
    const run = await running
    expect(run.cancelled).toBe(true)
    expect(run.resume).toBe(true)
    expect(
      fake.localArgv.some((argv) => formatArgv(argv).includes('pg_restore'))
    ).toBe(false)
  })

  it('reports false when there is nothing to cancel', () => {
    expect(cancelActiveDatabaseMigration()).toBe(false)
    expect(cancelActiveBringUp()).toBe(false)
  })
})

describe('S5.2 — resolving and running the bring-up checklist', () => {
  it('defaults the ports, app names and start scripts for /opt/zoonestore', async () => {
    const { job, error } = await resolveBringUpJob(options(newFake()), BRING_UP_REQUEST)
    expect(error).toBeUndefined()
    expect(job).toMatchObject({
      projectPath: '/opt/zoonestore',
      apiPort: 3200,
      webPort: 3201,
      apiApp: 'zoonestore-api',
      webApp: 'zoonestore-web',
      apiScript: 'start:api',
      webScript: 'start:web',
      requiredEnvKeys: ['DATABASE_URL', 'NODE_ENV']
    })
    expect(job?.domains).toEqual(['goldenmode2.com', 'zoonestore.ir'])
  })

  it('refuses an invalid domain, port or env key name instead of building a command from it', async () => {
    const fake = newFake()
    const opts = options(fake)
    expect((await resolveBringUpJob(opts, { ...BRING_UP_REQUEST, domains: ['a b'] })).error).toBeDefined()
    expect((await resolveBringUpJob(opts, { ...BRING_UP_REQUEST, apiPort: 0 })).error).toBeDefined()
    expect(
      (await resolveBringUpJob(opts, { ...BRING_UP_REQUEST, requiredEnvKeys: ['A=1; rm'] })).error
    ).toBeDefined()
    expect(fake.commands).toEqual([])
  })

  it('plans the checklist without running a single mutating step', async () => {
    const fake = newFake()
    const plan = await planBringUpRequest(options(fake), BRING_UP_REQUEST)
    expect(plan.blocked).toBe(false)
    expect(plan.mode).toBe('relay')
    expect(plan.steps).toHaveLength(20)
    expect(fake.commands).toEqual([])
    expect(fake.localArgv).toEqual([])
  })

  it('runs the checklist step by step and audits the outcome once', async () => {
    const fake = newFake()
    const run = await runBringUpRequest(options(fake), BRING_UP_REQUEST)
    expect(run.results.filter((result) => result.status !== 'pass')).toEqual([])
    expect(run.ok).toBe(true)
    expect(fake.audits).toHaveLength(1)
    expect(fake.audits[0]?.startsWith('true:')).toBe(true)
  })

  it('resumes from the steps an earlier run passed', async () => {
    const fake = newFake()
    const run = await runBringUpRequest(options(fake), {
      ...BRING_UP_REQUEST,
      completed: ['env-file', 'env-keys', 'install', 'build']
    })
    expect(run.resume).toBe(true)
    expect(run.results.find((result) => result.id === 'install')?.status).toBe('skipped')
    expect(fake.commands.some((entry) => entry.command.includes('npm ci'))).toBe(false)
  })

  it('can be cancelled between steps', async () => {
    const fake = newFake()
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let started: () => void = () => undefined
    const reached = new Promise<void>((resolve) => {
      started = resolve
    })
    const base = options(fake)
    const running = runBringUpRequest(
      {
        ...base,
        local: async (argv) => {
          const outcome = await base.local(argv)
          if (formatArgv(argv).includes('nginx-fetch') || formatArgv(argv).includes('sites-available')) {
            started()
            await gate
          }
          return outcome
        }
      },
      BRING_UP_REQUEST
    )
    await reached
    expect(cancelActiveBringUp()).toBe(true)
    release()
    const run = await running
    expect(run.cancelled).toBe(true)
    expect(run.results.some((result) => result.status === 'pass')).toBe(true)
  })
})
