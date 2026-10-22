import { describe, expect, it } from 'vitest'
import type { MigrationEndpoint } from '../../src/shared/migration'
import { formatArgv } from '../../src/core/tools/migrate-argv'
import {
  DEFAULT_DB_USER,
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
  defaultDumpPath,
  isSafeContainerName,
  isSafeDatabaseName,
  parseContainerRunning,
  parseDatabaseBaseline,
  parseDigestAndBytes,
  parseNumberOutput,
  validateDatabaseJob
} from '../../src/core/tools/db-migrate-argv'

/**
 * S5.1 — the command layer of a database migration, asserted verbatim.
 *
 * The acceptance stack runs `postgres:16` in a container on the source, listening on
 * `127.0.0.1:5433` *on the host*. Every command here goes through `docker exec`, so the port
 * mapping is irrelevant: `pg_dump` talks to the unix socket inside the container, which is also
 * why no password ever appears on a command line (`-w` fails fast instead of prompting).
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

const ENDPOINT = {
  container: 'zoonestore-postgres',
  database: 'zoonestore',
  user: 'postgres'
}

const DUMP = '/var/tmp/ai-desktop-db/zoonestore.dump'

describe('S5.1 — postgres in a docker container, never a password on the command line', () => {
  it('probes the container instead of assuming it is running', () => {
    expect(buildContainerProbeCommand('zoonestore-postgres')).toBe(
      "docker inspect -f '{{.State.Running}}' zoonestore-postgres"
    )
  })

  it('estimates the size from the catalog, which a dry-run may read', () => {
    expect(buildDatabaseEstimateCommand(ENDPOINT)).toBe(
      'docker exec zoonestore-postgres psql -w -U postgres -d zoonestore -tAc ' +
        "'select pg_database_size(current_database())'"
    )
  })

  it('counts tables and takes an exact row count for a bounded sample of them', () => {
    const command = buildDatabaseBaselineCommand(ENDPOINT, 20)

    expect(command).toContain('printf \'tables=%s\\n\'')
    expect(command).toContain('from information_schema.tables')
    expect(command).toContain('printf \'rows=%s\\n\'')
    // Exact counts, not `reltuples`: a restore does not ANALYZE, so the estimate would read 0.
    expect(command).toContain('query_to_xml')
    expect(command).not.toContain('reltuples')
    expect(command).toContain('limit 20')
    // Nothing secret and nothing destructive.
    expect(command).not.toMatch(/password/i)
    expect(command).not.toMatch(/pg_restore|drop|delete|truncate/i)
  })

  it('a sample size of zero is clamped to one table, never to "none"', () => {
    expect(buildDatabaseBaselineCommand(ENDPOINT, 0)).toContain('limit 1')
  })

  it('dumps in the custom format through docker exec, into a file we name', () => {
    expect(buildDumpCommand(ENDPOINT, DUMP)).toBe(
      `docker exec zoonestore-postgres pg_dump -w -U postgres -Fc -d zoonestore > ${DUMP}`
    )
  })

  it('reads the dump’s sha256 and its size in one round trip', () => {
    expect(buildDumpDigestCommand(DUMP)).toBe(
      `printf 'sha256=%s\\n' "$(sha256sum -- ${DUMP} | cut -d' ' -f1)"` +
        ` && printf 'bytes=%s\\n' "$(stat -c %s -- ${DUMP})"`
    )
  })

  it('asks whether the target already holds this exact dump, which is what makes a resume cheap', () => {
    expect(buildExistingDigestCommand(DUMP)).toBe(
      `if [ -f ${DUMP} ]; then printf 'sha256=%s\\n' "$(sha256sum -- ${DUMP} | cut -d' ' -f1)"; else echo none; fi`
    )
  })

  it('makes the dump directory without touching anything else', () => {
    expect(buildPrepareDirCommand(DUMP)).toBe('mkdir -p /var/tmp/ai-desktop-db')
  })

  it('creates the database only when it is missing, so a rerun is not an error', () => {
    expect(buildPrepareDatabaseCommand(ENDPOINT)).toBe(
      'docker exec zoonestore-postgres psql -w -U postgres -tAc ' +
        "\"select 1 from pg_database where datname='zoonestore'\" | grep -qx 1 || " +
        'docker exec zoonestore-postgres createdb -w -U postgres zoonestore'
    )
  })

  it('restores from the dump on stdin, cleanly and idempotently', () => {
    const command = buildRestoreCommand(ENDPOINT, DUMP)
    expect(command).toBe(
      'docker exec -i zoonestore-postgres pg_restore -w -U postgres -d zoonestore ' +
        `--clean --if-exists --no-owner --no-privileges < ${DUMP}`
    )
    // A restore is the one destructive step, so it is named as such rather than hidden in a loop.
    expect(command).not.toMatch(/dropdb|rm -rf/)
  })
})

describe('S5.1 — moving the dump is a file transfer, not a directory sync', () => {
  it('pulls source → this computer with no trailing slash on the file', () => {
    const argv = buildFileRsyncArgv({
      from: { username: 'root', host: '91.107.174.210', port: 22, path: DUMP },
      to: '/var/tmp/ai-desktop-migrate/212.16.86.23/db/'
    })
    expect(argv).toEqual([
      'rsync',
      '-az',
      '--info=stats2',
      '-e',
      'ssh -p 22 -o BatchMode=yes -o StrictHostKeyChecking=accept-new',
      `root@91.107.174.210:${DUMP}`,
      '/var/tmp/ai-desktop-migrate/212.16.86.23/db/'
    ])
    expect(formatArgv(argv)).toBe(
      "rsync -az --info=stats2 -e 'ssh -p 22 -o BatchMode=yes -o StrictHostKeyChecking=accept-new' " +
        `root@91.107.174.210:${DUMP} /var/tmp/ai-desktop-migrate/212.16.86.23/db/`
    )
  })

  it('pushes this computer → target, keeping the file name', () => {
    const argv = buildFileRsyncArgv({
      from: `${'/var/tmp/ai-desktop-migrate/212.16.86.23/db/'}zoonestore.dump`,
      to: { username: 'root', host: '212.16.86.23', port: 22, path: DUMP }
    })
    expect(argv[argv.length - 1]).toBe(`root@212.16.86.23:${DUMP}`)
    expect(argv[argv.length - 2]).toBe('/var/tmp/ai-desktop-migrate/212.16.86.23/db/zoonestore.dump')
  })

  it('writes an IPv6 target with brackets, exactly once', () => {
    const argv = buildFileRsyncArgv({
      from: DUMP,
      to: { username: 'root', host: '2001:db8::1', port: 22, path: DUMP }
    })
    expect(argv[argv.length - 1]).toBe(`root@[2001:db8::1]:${DUMP}`)
    expect(argv[argv.length - 1]).not.toContain('[[')
  })

  it('refuses a transfer with no remote end, so a typo cannot become a local copy', () => {
    expect(() => buildFileRsyncArgv({ from: DUMP, to: DUMP })).toThrow(/remote/)
  })
})

describe('S5.1 — parsers: a missing number is never zero', () => {
  it('reads the table count and the sampled row counts', () => {
    const baseline = parseDatabaseBaseline(
      'tables=37\nrows=accounts=1204\nusers=88\nsessions=9102\n'
    )
    expect(baseline).toBeDefined()
    expect(baseline?.tables).toBe(37)
    expect(baseline?.sample).toEqual([
      { table: 'accounts', rows: 1204 },
      { table: 'users', rows: 88 },
      { table: 'sessions', rows: 9102 }
    ])
  })

  it('keeps a table whose name contains a separator, by splitting on the last `=`', () => {
    expect(parseDatabaseBaseline('tables=1\nrows=a=b=3\n')?.sample).toEqual([{ table: 'a=b', rows: 3 }])
  })

  it('returns undefined for an unreadable baseline, so it can never pass a comparison', () => {
    expect(parseDatabaseBaseline('')).toBeUndefined()
    expect(parseDatabaseBaseline('psql: error: connection refused')).toBeUndefined()
    expect(parseDatabaseBaseline('tables=abc\nrows=\n')).toBeUndefined()
  })

  it('accepts an empty database (zero tables is a real answer, not a failure)', () => {
    expect(parseDatabaseBaseline('tables=0\nrows=\n')).toEqual({ tables: 0, sample: [] })
  })

  it('reads the digest and the byte count together', () => {
    const parsed = parseDigestAndBytes(`sha256=${'b'.repeat(64)}\nbytes=524288000\n`)
    expect(parsed).toEqual({ sha256: 'b'.repeat(64), bytes: 524288000 })
    expect(parseDigestAndBytes('none')).toEqual({})
    expect(parseDigestAndBytes('')).toEqual({})
  })

  it('reads a single number, and nothing for junk', () => {
    expect(parseNumberOutput(' 4800000000\n')).toBe(4800000000)
    expect(parseNumberOutput('ERROR: database does not exist')).toBeUndefined()
  })

  it('reads the container probe', () => {
    expect(parseContainerRunning('true\n')).toBe(true)
    expect(parseContainerRunning('false\n')).toBe(false)
    expect(parseContainerRunning('Error: No such object: zoo\n')).toBeUndefined()
  })
})

describe('S5.1 — validation before a single command is built', () => {
  it('accepts the reported container and database', () => {
    expect(validateDatabaseJob(ENDPOINT).ok).toBe(true)
  })

  it('defaults the user to postgres and the dump path to a derived absolute path', () => {
    const checked = validateDatabaseJob({ container: 'zoonestore-postgres', database: 'zoonestore' })
    expect(checked.user).toBe(DEFAULT_DB_USER)
    expect(checked.dumpPath).toBe(defaultDumpPath('zoonestore'))
    expect(defaultDumpPath('zoonestore')).toBe('/var/tmp/ai-desktop-db/zoonestore.dump')
  })

  it('refuses a name that would be parsed as a flag or a second command', () => {
    expect(validateDatabaseJob({ container: '--rm', database: 'zoonestore' }).ok).toBe(false)
    expect(validateDatabaseJob({ container: 'zoonestore-postgres', database: "z';drop table x;--" }).ok).toBe(
      false
    )
    expect(validateDatabaseJob({ container: 'zoonestore-postgres', database: 'zoonestore', user: 'a b' }).ok).toBe(
      false
    )
    expect(validateDatabaseJob({ container: 'zoonestore-postgres', database: '' }).ok).toBe(false)
  })

  it('refuses a dump path outside a temporary directory or one with shell characters', () => {
    expect(
      validateDatabaseJob({ container: 'c', database: 'd', dumpPath: '/etc/letsencrypt/x.dump' }).ok
    ).toBe(false)
    expect(validateDatabaseJob({ container: 'c', database: 'd', dumpPath: '/var/tmp/a b.dump' }).ok).toBe(false)
    expect(validateDatabaseJob({ container: 'c', database: 'd', dumpPath: 'relative.dump' }).ok).toBe(false)
  })

  it('exposes the two name predicates the flow needs, and neither is permissive', () => {
    expect(isSafeContainerName('zoonestore-postgres')).toBe(true)
    expect(isSafeContainerName('zoonestore postgres')).toBe(false)
    expect(isSafeContainerName('-leading')).toBe(false)
    expect(isSafeDatabaseName('zoonestore')).toBe(true)
    expect(isSafeDatabaseName('zoo-store_2')).toBe(true)
    expect(isSafeDatabaseName('zoo;rm')).toBe(false)
  })

  it('keeps the two endpoints out of the command layer: it is told the container, not the host', () => {
    const command = buildDumpCommand(ENDPOINT, DUMP)
    expect(command).not.toContain('91.107.174.210')
    expect(command).not.toContain(SOURCE.host)
    expect(command).not.toContain(TARGET.host)
  })
})
