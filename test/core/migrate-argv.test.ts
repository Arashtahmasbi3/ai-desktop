import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MIGRATION_EXCLUDES,
  buildBaselineCommand,
  buildDiskFreeCommand,
  buildKeyCheckCommand,
  buildRsyncArgv,
  buildSampleHashCommand,
  buildSshRemoteArgv,
  buildStagingProbeCommand,
  buildVersionCommand,
  formatArgv,
  localStagingPathFor,
  parseBaseline,
  parseDf,
  parseStagingProbe,
  parseVersions,
  stagingPathFor,
  validateExcludes,
  type RsyncRemote
} from '../../src/core/tools/migrate-argv'
import { buildRsyncCommand } from '../../src/core/tools/migrate-project-tool'

/**
 * S4.4 / S4.7 — the command layer is where a migration is either safe or wrong, so the assertions
 * here are on the **exact argv**, not on substrings of a shell string. The one thing that must never
 * happen is a destination that rsync reads differently from the way we mean it.
 */

const SOURCE: RsyncRemote = {
  username: 'root',
  host: '91.107.174.210',
  port: 22,
  path: '/opt/zoonestore'
}

const TARGET: RsyncRemote = {
  username: 'root',
  host: '212.16.86.23',
  port: 22,
  path: '/opt/zoonestore'
}

/** The exact arguments of the direct transfer for the reported project. */
const DIRECT_ARGV = [
  'rsync',
  '-az',
  '--info=stats2',
  '--partial',
  '--exclude=node_modules',
  '--exclude=.next',
  '--exclude=builds',
  '--exclude=artifacts',
  '--exclude=backups',
  '-e',
  'ssh -p 22 -o BatchMode=yes -o StrictHostKeyChecking=accept-new',
  '/opt/zoonestore/',
  'root@212.16.86.23:/opt/zoonestore.migrating/'
]

describe('buildRsyncArgv (S4.3/S4.4)', () => {
  it('builds the exact direct argv with every default exclude', () => {
    expect(
      buildRsyncArgv({
        from: SOURCE.path,
        to: { ...TARGET, path: stagingPathFor(TARGET.path) },
        excludes: DEFAULT_MIGRATION_EXCLUDES
      })
    ).toEqual(DIRECT_ARGV)
  })

  it('never adds --delete, with or without --dry-run', () => {
    const plain = buildRsyncArgv({ from: '/src', to: TARGET, excludes: [] })
    const dry = buildRsyncArgv({ from: '/src', to: TARGET, excludes: [], dryRun: true })
    expect(plain.join(' ')).not.toContain('--delete')
    expect(dry.join(' ')).not.toContain('--delete')
    expect(plain).not.toContain('--dry-run')
    expect(dry).toContain('--dry-run')
  })

  it('uses the edited exclude list verbatim, in order', () => {
    const argv = buildRsyncArgv({
      from: '/src',
      to: TARGET,
      excludes: ['node_modules', '*.log']
    })
    expect(argv).toContain('--exclude=node_modules')
    expect(argv).toContain('--exclude=*.log')
    expect(argv).not.toContain('--exclude=.next')
  })

  it('takes the ssh port of whichever side is remote', () => {
    const pull = buildRsyncArgv({
      from: { ...SOURCE, port: 2222 },
      to: '/var/tmp/staging'
    })
    expect(pull).toContain('ssh -p 2222 -o BatchMode=yes -o StrictHostKeyChecking=accept-new')
    expect(pull[pull.length - 2]).toBe('root@91.107.174.210:/opt/zoonestore/')
    expect(pull[pull.length - 1]).toBe('/var/tmp/staging/')
  })

  it('refuses a transfer with no remote end at all', () => {
    expect(() => buildRsyncArgv({ from: '/a', to: '/b', excludes: [] })).toThrow(/remote/i)
  })
})

describe('rsync destination specs and IPv6 (S4.7)', () => {
  it('brackets an IPv6 target in the rsync destination', () => {
    const argv = buildRsyncArgv({
      from: '/opt/zoonestore',
      to: { username: 'root', host: '2a01:4f8:1c1c:1000::1', port: 22, path: '/opt/zoonestore' },
      excludes: []
    })
    expect(argv[argv.length - 1]).toBe('root@[2a01:4f8:1c1c:1000::1]:/opt/zoonestore/')
  })

  it('brackets an IPv6 target in the ssh command line, and strips stored brackets', () => {
    const argv = buildSshRemoteArgv(
      { username: 'root', host: '[2a01:4f8::1]', port: 2222 },
      'true'
    )
    expect(argv).toEqual([
      'ssh',
      '-p',
      '2222',
      '-o',
      'BatchMode=yes',
      '-o',
      'StrictHostKeyChecking=accept-new',
      'root@[2a01:4f8::1]',
      'true'
    ])
  })

  it('also brackets IPv6 in the existing migrate_project rsync command', () => {
    // The tool already accepted a bare IPv6 `target_host` but wrote `user@::1:/path`,
    // which rsync reads as a host named `::1` only by accident of its own parser.
    const command = buildRsyncCommand(
      '/var/www/app',
      { host: '2a01:4f8::1', port: 22, username: 'root' },
      '/srv/app'
    )
    expect(command).toContain("'root@[2a01:4f8::1]:/srv/app/'")
    expect(command).not.toContain('root@2a01')
  })
})

describe('formatArgv', () => {
  it('quotes only the arguments a shell would otherwise split or expand', () => {
    expect(
      formatArgv(['rsync', '-az', '/a b/', 'root@[2a01::1]:/x/', '--exclude=*.log'])
    ).toBe("rsync -az '/a b/' 'root@[2a01::1]:/x/' '--exclude=*.log'")
  })

  it('round-trips a command the shell can re-split into the same argv', () => {
    const argv = ['ssh', '-p', '22', 'root@h', 'mv -T /a.migrating /a']
    expect(formatArgv(argv)).toBe("ssh -p 22 root@h 'mv -T /a.migrating /a'")
  })
})

describe('validateExcludes (S4.4)', () => {
  it('accepts plain directory names and globs', () => {
    expect(validateExcludes(['node_modules', '.next', '*.log', 'cache[0-9]']).excludes).toEqual([
      'node_modules',
      '.next',
      '*.log',
      'cache[0-9]'
    ])
  })

  it('rejects anything that is not a single path component, or names nothing', () => {
    for (const bad of ['', '*', '**', '../etc', 'a/b', '-rf', 'a b', "a'b", 'a;rm', '.']) {
      const result = validateExcludes([bad])
      expect(result.reason, bad).toBeTruthy()
    }
  })

  it('falls back to the defaults for a missing list and strips duplicates', () => {
    expect(validateExcludes(undefined).excludes).toEqual([...DEFAULT_MIGRATION_EXCLUDES])
    expect(validateExcludes(['node_modules', 'node_modules']).excludes).toEqual(['node_modules'])
  })
})

describe('staging paths (S4.6)', () => {
  it('derives the staging directory from the destination, so a resume reuses it', () => {
    expect(stagingPathFor('/opt/zoonestore')).toBe('/opt/zoonestore.migrating')
    expect(stagingPathFor('/opt/zoonestore/')).toBe('/opt/zoonestore.migrating')
    expect(stagingPathFor('/opt/zoonestore.migrating')).toBe('/opt/zoonestore.migrating')
  })

  it('derives the local staging directory for the relay leg', () => {
    expect(localStagingPathFor('/var/tmp/ai-desktop-migrate', '/opt/zoonestore')).toBe(
      '/var/tmp/ai-desktop-migrate/zoonestore/'
    )
  })
})

describe('preflight commands', () => {
  it('asks df for one POSIX line, in kilobytes', () => {
    expect(buildDiskFreeCommand('/opt/zoonestore')).toBe("df -Pk '/opt/zoonestore'")
  })

  it('checks key authentication with ssh BatchMode rather than a password prompt', () => {
    expect(buildKeyCheckCommand(TARGET)).toBe(
      'ssh -p 22 -o BatchMode=yes -o StrictHostKeyChecking=accept-new root@212.16.86.23 true'
    )
  })

  it('reads the staging directory size, and says so when it is absent', () => {
    const command = buildStagingProbeCommand('/opt/zoonestore.migrating')
    expect(command).toContain("if [ -d '/opt/zoonestore.migrating' ]")
    expect(command).toContain('du -sk')
    expect(command).toContain('echo none')
  })

  it('asks every runtime for its version in one round trip', () => {
    const command = buildVersionCommand()
    for (const tool of ['nginx', 'node', 'docker', 'postgres']) {
      expect(command).toContain(`${tool}=`)
    }
  })

  it('counts files, dirs and bytes with the same excludes the transfer uses', () => {
    const command = buildBaselineCommand('/opt/zoonestore', DEFAULT_MIGRATION_EXCLUDES)
    expect(command.startsWith("cd '/opt/zoonestore' && find . -mindepth 1")).toBe(true)
    for (const name of DEFAULT_MIGRATION_EXCLUDES) {
      expect(command).toContain(`-name '${name}'`)
    }
    expect(command).toContain('-prune')
    expect(command).toContain('files=%d dirs=%d bytes=%d')
    expect(command).toContain('ls -A')
  })

  it('hashes a deterministic sample of files, not the whole tree', () => {
    const command = buildSampleHashCommand('/opt/zoonestore', DEFAULT_MIGRATION_EXCLUDES, 37, 20)
    expect(command).toContain('NR % 37 == 1')
    expect(command).toContain('head -n 20')
    expect(command).toContain('sha256sum --')
    expect(command).toContain('LC_ALL=C sort')
  })
})

describe('parsers', () => {
  it('reads the POSIX df line', () => {
    const stdout = [
      'Filesystem     1024-blocks     Used Available Capacity Mounted on',
      '/dev/sda1         38000000 32000000   4100000      89% /'
    ].join('\n')
    expect(parseDf(stdout)).toEqual({
      totalKb: 38000000,
      usedKb: 32000000,
      availKb: 4100000,
      percent: 89
    })
    expect(parseDf('nonsense')).toBeUndefined()
  })

  it('reads the baseline numbers and the top-level entries', () => {
    const stdout = 'files=1204 dirs=88 bytes=7912345678\ntop=.env apps package.json\n'
    expect(parseBaseline(stdout)).toEqual({
      files: 1204,
      dirs: 88,
      bytes: 7912345678,
      top: ['.env', 'apps', 'package.json']
    })
  })

  it('treats a missing baseline as absent rather than as zero', () => {
    expect(parseBaseline('')).toBeUndefined()
  })

  it('reads the staging probe', () => {
    expect(parseStagingProbe('5242880\n')).toEqual({ exists: true, kb: 5242880 })
    expect(parseStagingProbe('none')).toEqual({ exists: false, kb: 0 })
  })

  it('extracts a version from each runtime banner', () => {
    const stdout = [
      'nginx=nginx version: nginx/1.24.0',
      'node=v20.11.1',
      'docker=Docker version 27.0.3, build 7d4bcd8',
      'postgres=psql (PostgreSQL) 16.3 (Ubuntu 16.3-1.pgdg22.04+1)'
    ].join('\n')
    expect(parseVersions(stdout)).toEqual({
      nginx: '1.24.0',
      node: '20.11.1',
      docker: '27.0.3',
      postgres: '16.3'
    })
  })

  it('reports a missing runtime as undefined instead of a version', () => {
    expect(parseVersions('nginx=nginx version: nginx/1.24.0\nnode=\n')).toEqual({
      nginx: '1.24.0',
      node: undefined,
      docker: undefined,
      postgres: undefined
    })
  })
})
