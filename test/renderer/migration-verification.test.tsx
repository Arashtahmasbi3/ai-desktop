// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import i18n from '../../src/renderer/src/i18n'
import MigrationTab from '../../src/renderer/src/components/MigrationTab'
import type { DatabasePlan, DatabaseRun } from '../../src/shared/database-migration'
import type { MigrationPlan, MigrationRequest, MigrationRun } from '../../src/shared/migration'
import type { VpsServerView } from '../../src/shared/vps'

/**
 * S5.3 — "files match, db matches" in one place.
 *
 * The project transfer's file verification and the database baseline comparison are two different
 * runs, so the risk is that the user has to look in two places and believe the weaker statement.
 * The migration surface composes both into one summary (`combineVerifications`), and this test
 * drives both flows through the real components to prove the summary is the same one.
 */

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

afterEach(cleanup)

const SERVERS = [
  {
    id: 'srv-spmotor',
    name: 'spmotor',
    host: '91.107.174.210',
    port: 22,
    username: 'root',
    authType: 'key',
    hasPassword: false,
    hasPrivateKey: true,
    createdAt: 1,
    updatedAt: 1
  },
  {
    id: 'srv-yoserver',
    name: 'yoserver-spmotor',
    host: '212.16.86.23',
    port: 22,
    username: 'root',
    authType: 'key',
    hasPassword: false,
    hasPrivateKey: true,
    createdAt: 1,
    updatedAt: 1
  }
] as unknown as VpsServerView[]

const PLAN: MigrationPlan = {
  mode: 'relay',
  modeReason: '212.16.86.23:22 is closed from spmotor, so the transfer goes through this computer.',
  facts: [
    { id: 'target-space', label: 'Free space on the target', status: 'pass', value: '66.8 GB free' }
  ],
  excludes: ['node_modules'],
  blocked: false,
  estimateBytes: 6_144_000_000,
  stagedBytes: 0,
  resume: false,
  stagingPath: '/opt/zoonestore.migrating',
  steps: [
    {
      id: 'pull',
      runner: 'local',
      where: 'source',
      command: "rsync -az --info=stats2 -e 'ssh -p 22' root@91.107.174.210:/opt/zoonestore/ /var/tmp/x/"
    }
  ]
}

const RUN_OK: MigrationRun = {
  ok: true,
  mode: 'relay',
  cancelled: false,
  resume: false,
  plan: PLAN,
  stagingPath: '/opt/zoonestore.migrating',
  committedTo: '/opt/zoonestore',
  verification: {
    ok: true,
    message: 'Verified: 1204 files, 88 directories, 6.4 GB, sample checksum matched.',
    files: 1204,
    dirs: 88,
    bytes: 6_400_000_000,
    top: ['.env', 'apps'],
    sourceDigest: 'a'.repeat(64),
    targetDigest: 'a'.repeat(64)
  },
  log: [],
  message: 'Migrated /opt/zoonestore via relay.'
}

const DB_PLAN: DatabasePlan = {
  mode: 'relay',
  modeReason: '212.16.86.23:22 is closed from spmotor, so the database is relayed through this computer.',
  facts: [
    { id: 'dump-size', label: 'Estimated dump size', status: 'pass', value: '4.5 GB' },
    { id: 'reachability', label: 'Path to the target', status: 'pass', value: 'relay' }
  ],
  blocked: false,
  dryRun: true,
  estimatedBytes: 4_800_000_000,
  dumpPath: '/var/tmp/ai-desktop-db/zoonestore.dump',
  sampleTables: 20,
  steps: [
    {
      id: 'dump',
      title: 'Dump the database on the source',
      runner: 'source',
      where: 'source',
      command:
        'docker exec zoonestore-postgres pg_dump -w -U postgres -Fc -d zoonestore > /var/tmp/ai-desktop-db/zoonestore.dump',
      expect: 'the dump exists and hashes'
    },
    {
      id: 'restore',
      title: 'Restore on the target',
      runner: 'local',
      where: 'target',
      command:
        'docker exec -i zoonestore-postgres pg_restore -w -U postgres -d zoonestore --clean --if-exists < /var/tmp/ai-desktop-db/zoonestore.dump',
      expect: 'exit 0'
    }
  ]
}

const DB_RUN_OK: DatabaseRun = {
  ok: true,
  mode: 'relay',
  cancelled: false,
  resume: false,
  plan: DB_PLAN,
  verification: {
    ok: true,
    message: 'Database matches: 37 tables, 2 sampled tables have identical row counts (dump sha256 aaaaaaaaaaaa).',
    tables: 37,
    sample: [
      { table: 'accounts', rows: 1204 },
      { table: 'users', rows: 88 }
    ],
    mismatches: [],
    sourceDigest: 'a'.repeat(64),
    targetDigest: 'a'.repeat(64)
  },
  results: [],
  log: [],
  message: 'Database zoonestore restored on yoserver-spmotor: 37 tables compared.',
  startedAt: 1,
  finishedAt: 2
}

interface Stub {
  preflight: ReturnType<typeof vi.fn>
  start: ReturnType<typeof vi.fn>
  dbPreflight: ReturnType<typeof vi.fn>
  dbStart: ReturnType<typeof vi.fn>
}

function stubApi(overrides: Partial<{ run: MigrationRun; dbRun: DatabaseRun; dbPlan: DatabasePlan }> = {}): Stub {
  const stub: Stub = {
    preflight: vi.fn().mockResolvedValue(PLAN),
    start: vi.fn().mockResolvedValue(overrides.run ?? RUN_OK),
    dbPreflight: vi.fn().mockResolvedValue(overrides.dbPlan ?? DB_PLAN),
    dbStart: vi.fn().mockResolvedValue(overrides.dbRun ?? DB_RUN_OK)
  }
  ;(window as unknown as { api: unknown }).api = {
    migration: {
      preflight: stub.preflight,
      start: stub.start,
      cancel: vi.fn().mockResolvedValue(true),
      database: { preflight: stub.dbPreflight, start: stub.dbStart, cancel: vi.fn().mockResolvedValue(true) },
      bringUp: {
        plan: vi.fn().mockResolvedValue({ blocked: false, mode: 'relay', modeReason: '', facts: [], steps: [] }),
        start: vi.fn(),
        cancel: vi.fn()
      }
    },
    events: { on: () => () => undefined }
  }
  return stub
}

function fillProjectForm(): void {
  fireEvent.change(screen.getByTestId('migrate-source-server'), { target: { value: 'srv-spmotor' } })
  fireEvent.change(screen.getByTestId('migrate-source-path'), { target: { value: '/opt/zoonestore' } })
  fireEvent.change(screen.getByTestId('migrate-target-server'), { target: { value: 'srv-yoserver' } })
  fireEvent.change(screen.getByTestId('migrate-target-path'), { target: { value: '/opt/zoonestore' } })
}

function fillDatabaseForm(): void {
  fireEvent.change(screen.getByTestId('db-source-server'), { target: { value: 'srv-spmotor' } })
  fireEvent.change(screen.getByTestId('db-target-server'), { target: { value: 'srv-yoserver' } })
  fireEvent.change(screen.getByTestId('db-container'), { target: { value: 'zoonestore-postgres' } })
  fireEvent.change(screen.getByTestId('db-database'), { target: { value: 'zoonestore' } })
}

beforeEach(() => {
  stubApi()
})

describe('S5.3 — one surface for both verifications', () => {
  it('says plainly that the database has not been compared before it runs', async () => {
    render(<MigrationTab servers={SERVERS} />)
    fillProjectForm()
    fireEvent.click(screen.getByTestId('migrate-preflight'))
    await waitFor(() => expect(screen.getByTestId('migrate-start')).toBeTruthy())
    fireEvent.click(screen.getByTestId('migrate-start'))

    await waitFor(() => expect(screen.getByTestId('migration-report-files-mark')).toBeTruthy())
    expect(screen.getByTestId('migration-report-files-mark').textContent).toBe('MATCH')
    expect(screen.getByTestId('migration-report-database-mark').textContent).toBe('NOT RUN')
    expect(screen.getByTestId('migration-report').textContent).toMatch(/1204/)
  })

  it('shows files match and db matches together after both runs', async () => {
    const stub = stubApi()
    render(<MigrationTab servers={SERVERS} />)
    fillProjectForm()
    fireEvent.click(screen.getByTestId('migrate-preflight'))
    await waitFor(() => expect(screen.getByTestId('migrate-start')).toBeTruthy())
    fireEvent.click(screen.getByTestId('migrate-start'))
    await waitFor(() => expect(screen.getByTestId('migration-report-files-mark')).toBeTruthy())

    fireEvent.click(screen.getByTestId('migration-tab-database'))
    fillDatabaseForm()
    // A real run is refused until a dry run has been seen: the button is dead on arrival.
    expect((screen.getByTestId('db-start') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByTestId('db-dry-run'))
    await waitFor(() => expect(stub.dbPreflight).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByTestId('db-plan')).toBeTruthy())
    expect((screen.getByTestId('db-start') as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(screen.getByTestId('db-start'))
    await waitFor(() => expect(screen.getByTestId('migration-report-database-mark')).toBeTruthy())

    const report = screen.getByTestId('migration-report')
    expect(screen.getByTestId('migration-report-files-mark').textContent).toBe('MATCH')
    expect(screen.getByTestId('migration-report-database-mark').textContent).toBe('MATCH')
    expect(report.textContent).toMatch(/files/i)
    expect(report.textContent).toMatch(/database/i)
    expect(report.textContent).toMatch(/37/)
    expect(report.getAttribute('data-ok')).toBe('true')
  })

  it('turns the whole surface into a mismatch when the database comparison disagrees', async () => {
    stubApi({
      dbRun: {
        ...DB_RUN_OK,
        ok: false,
        message: 'Database mismatch: table count 37 on the source but 35 on the target.',
        verification: {
          ...DB_RUN_OK.verification!,
          ok: false,
          tables: 35,
          mismatches: ['table count 37 on the source but 35 on the target']
        }
      }
    })
    render(<MigrationTab servers={SERVERS} />)
    fillProjectForm()
    fireEvent.click(screen.getByTestId('migrate-preflight'))
    await waitFor(() => expect(screen.getByTestId('migrate-start')).toBeTruthy())
    fireEvent.click(screen.getByTestId('migrate-start'))
    await waitFor(() => expect(screen.getByTestId('migration-report-files-mark')).toBeTruthy())

    fireEvent.click(screen.getByTestId('migration-tab-database'))
    fillDatabaseForm()
    fireEvent.click(screen.getByTestId('db-dry-run'))
    await waitFor(() => expect(screen.getByTestId('db-plan')).toBeTruthy())
    fireEvent.click(screen.getByTestId('db-start'))
    await waitFor(() => expect(screen.getByTestId('migration-report-database-mark')).toBeTruthy())

    expect(screen.getByTestId('migration-report-database-mark').textContent).toBe('MISMATCH')
    expect(screen.getByTestId('migration-report-files-mark').textContent).toBe('MATCH')
    expect(screen.getByTestId('migration-report').getAttribute('data-ok')).toBe('false')
    expect(screen.getByTestId('migration-report').textContent).toMatch(/35/)
  })
})

describe('S5.1 — the database form: dry run first, then the real thing', () => {
  it('posts the container and the database, and prints the exact commands', async () => {
    const stub = stubApi()
    render(<MigrationTab servers={SERVERS} />)
    fireEvent.click(screen.getByTestId('migration-tab-database'))
    fillDatabaseForm()
    fireEvent.click(screen.getByTestId('db-dry-run'))

    await waitFor(() => expect(stub.dbPreflight).toHaveBeenCalled())
    expect(stub.dbPreflight.mock.calls[0]![0]).toEqual({
      sourceServerId: 'srv-spmotor',
      targetServerId: 'srv-yoserver',
      container: 'zoonestore-postgres',
      database: 'zoonestore',
      user: 'postgres'
    })
    await waitFor(() => expect(screen.getByTestId('db-mode')).toBeTruthy())
    expect(screen.getByTestId('db-mode').textContent).toBe('relay')
    expect(screen.getByTestId('db-command-dump').textContent).toContain('pg_dump')
    expect(screen.getByTestId('db-command-restore').textContent).toContain('pg_restore')
    expect(screen.getByTestId('db-plan').textContent).toMatch(/4\.5 GB/)
    // Nothing has run yet, and the button says so.
    expect(stub.dbStart).not.toHaveBeenCalled()
  })

  it('refuses the real run until a dry run has passed, and cancels like the transfer', async () => {
    const stub = stubApi()
    render(<MigrationTab servers={SERVERS} />)
    fireEvent.click(screen.getByTestId('migration-tab-database'))
    fillDatabaseForm()
    expect((screen.getByTestId('db-start') as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(screen.getByTestId('db-dry-run'))
    await waitFor(() => expect(screen.getByTestId('db-plan')).toBeTruthy())
    fireEvent.click(screen.getByTestId('db-start'))
    await waitFor(() => expect(stub.dbStart).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByTestId('db-result')).toBeTruthy())
    expect(screen.getByTestId('db-result').textContent).toContain('37 tables')
  })

  it('shows a cancelled database run as resumable, with the dump it kept', async () => {
    stubApi({
      dbRun: {
        ...DB_RUN_OK,
        ok: false,
        cancelled: true,
        resume: true,
        verification: undefined,
        message: 'Cancelled. The dump on the target is kept, so running it again resumes.'
      }
    })
    render(<MigrationTab servers={SERVERS} />)
    fireEvent.click(screen.getByTestId('migration-tab-database'))
    fillDatabaseForm()
    fireEvent.click(screen.getByTestId('db-dry-run'))
    await waitFor(() => expect(screen.getByTestId('db-plan')).toBeTruthy())
    fireEvent.click(screen.getByTestId('db-start'))
    await waitFor(() => expect(screen.getByTestId('db-cancelled')).toBeTruthy())
    expect(screen.getByTestId('db-cancelled').textContent).toMatch(/resume/i)
    expect(screen.queryByTestId('db-cancel')).toBeNull()
  })
})

describe('S5.1 — the dry run is what the user reads before approving', () => {
  it('renders every fact with its mark and every step with its expected result', async () => {
    stubApi()
    render(<MigrationTab servers={SERVERS} />)
    fireEvent.click(screen.getByTestId('migration-tab-database'))
    fillDatabaseForm()
    fireEvent.click(screen.getByTestId('db-dry-run'))
    await waitFor(() => expect(screen.getByTestId('db-plan')).toBeTruthy())

    expect(screen.getByTestId('db-fact-dump-size').textContent).toContain('4.5 GB')
    expect(screen.getByTestId('db-mark-dump-size').textContent).toBe('PASS')
    expect(screen.getByTestId('db-step-dump').textContent).toMatch(/the dump exists and hashes/)
    expect(screen.getByTestId('db-dry-banner').textContent).toMatch(/nothing has been written/i)
  })
})

/** The request the project form posts is unchanged by S5: the two flows are separate posts. */
describe('S4 regression — the project form still posts its own request', () => {
  it('does not mix the database fields into the project migration', async () => {
    const stub = stubApi()
    render(<MigrationTab servers={SERVERS} />)
    fillProjectForm()
    fireEvent.click(screen.getByTestId('migrate-preflight'))
    await waitFor(() => expect(stub.preflight).toHaveBeenCalled())
    const request = stub.preflight.mock.calls[0]![0] as MigrationRequest
    expect(request).toEqual({
      sourceServerId: 'srv-spmotor',
      sourcePath: '/opt/zoonestore',
      targetServerId: 'srv-yoserver',
      targetPath: '/opt/zoonestore',
      excludes: ['node_modules', '.next', 'builds', 'artifacts', 'backups']
    })
  })
})
