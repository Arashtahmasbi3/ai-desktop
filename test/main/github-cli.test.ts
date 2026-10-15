import { describe, expect, it } from 'vitest'
import {
  GH_FALLBACK_PATHS,
  detectGhCli,
  ghCandidates,
  parseGhAuthStatus,
  parseGhVersion,
  readGhToken
} from '../../src/main/github/gh-cli'
import { FakeRunner, runResult } from '../helpers/fake-runner'

/**
 * v2.8.1 — "I cannot connect to GitHub and it is very hard to connect to it."
 *
 * The CLI path is the one-click fix: on the machine in question `gh` is installed and
 * authenticated, and the app used it nowhere. These cases pin the parsing against the real
 * captured output, the Windows fallback, and that a failure is reported without a token.
 */
// Captured verbatim from `gh auth status` (gh 2.102.0) on the reporting machine.
const REAL_STATUS = `github.com
  ✓ Logged in to github.com account Arashtahmasbi3 (keyring)
  - Active account: true
  - Git operations protocol: https
  - Token: gho_************************************
  - Token scopes: 'admin:public_key', 'gist', 'read:org', 'repo'
`
const REAL_VERSION = 'gh version 2.102.0 (2026-09-30)\nhttps://github.com/cli/cli/releases/tag/v2.102.0\n'

describe('gh output parsing (v2.8.1)', () => {
  it('reads the version', () => {
    expect(parseGhVersion(REAL_VERSION)).toBe('2.102.0')
    expect(parseGhVersion('not a version')).toBeUndefined()
  })

  it('reads the login, host and scopes from the multi-account layout', () => {
    expect(parseGhAuthStatus(REAL_STATUS)).toEqual({
      login: 'Arashtahmasbi3',
      host: 'github.com',
      scopes: ['admin:public_key', 'gist', 'read:org', 'repo']
    })
  })

  it('returns null when nobody is logged in', () => {
    expect(parseGhAuthStatus('github.com\n  X Not logged in to any hosts\n')).toBeNull()
    expect(parseGhAuthStatus('garbage')).toBeNull()
  })

  it('offers the absolute Windows fallbacks, which the PATH often lacks', () => {
    expect(ghCandidates('win32')).toEqual(['gh', ...GH_FALLBACK_PATHS])
    expect(ghCandidates('linux')).toEqual(['gh'])
  })
})

describe('detectGhCli (v2.8.1)', () => {
  it('reports the login when the CLI is installed and authenticated', async () => {
    const runner = new FakeRunner((_file, args) =>
      runResult({ stdout: args[0] === '--version' ? REAL_VERSION : REAL_STATUS })
    )

    const detection = await detectGhCli(runner, 'linux')

    expect(detection).toEqual({
      available: true,
      version: '2.102.0',
      login: 'Arashtahmasbi3',
      host: 'github.com',
      scopes: ['admin:public_key', 'gist', 'read:org', 'repo']
    })
    expect(runner.calls.map((call) => call.args)).toEqual([['--version'], ['auth', 'status']])
  })

  it('says "not installed" when the runner rejects, without throwing', async () => {
    const runner = new FakeRunner(() => {
      throw new Error('spawn gh ENOENT')
    })

    await expect(detectGhCli(runner, 'linux')).resolves.toMatchObject({
      available: false,
      reason: 'spawn gh ENOENT'
    })
  })

  it('retries the absolute Windows paths when the bare command is missing', async () => {
    const runner = new FakeRunner((file, args) => {
      if (file === 'gh') throw new Error('spawn gh ENOENT')
      return runResult({ stdout: args[0] === '--version' ? REAL_VERSION : REAL_STATUS })
    })

    const detection = await detectGhCli(runner, 'win32')

    expect(detection.available).toBe(true)
    expect(detection.login).toBe('Arashtahmasbi3')
    // It tried `gh` first, then the fallback path.
    expect(runner.calls[0]?.file).toBe('gh')
    expect(runner.calls[1]?.file).toBe(GH_FALLBACK_PATHS[0])
  })

  it('distinguishes "installed but not logged in"', async () => {
    const runner = new FakeRunner((_file, args) =>
      args[0] === '--version'
        ? runResult({ stdout: REAL_VERSION })
        : runResult({ exitCode: 1, stdout: 'You are not logged into any GitHub hosts.' })
    )

    await expect(detectGhCli(runner, 'linux')).resolves.toEqual({
      available: true,
      version: '2.102.0',
      reason: 'not logged in'
    })
  })
})

describe('readGhToken (v2.8.1)', () => {
  it('returns the trimmed token', async () => {
    const runner = new FakeRunner(() => runResult({ stdout: '  gho_abc123\n' }))
    await expect(readGhToken(runner, 'linux')).resolves.toBe('gho_abc123')
    expect(runner.calls[0]?.args).toEqual(['auth', 'token'])
  })

  it('never puts a token in the failure message', async () => {
    const runner = new FakeRunner(() =>
      runResult({ exitCode: 1, stderr: 'error: gho_abcdefghijklmnopqrstuvwxyz0123456789 rejected' })
    )

    await expect(readGhToken(runner, 'linux')).rejects.toThrow(/Could not read a token/)
    // The redactor covers `gh[pousr]_…`, so a token echoed by the CLI cannot leak into a toast.
    await expect(readGhToken(runner, 'linux')).rejects.not.toThrow(
      /gho_abcdefghijklmnopqrstuvwxyz0123456789/
    )
  })

  it('reports an empty token as a failure', async () => {
    const runner = new FakeRunner(() => runResult({ stdout: '\n' }))
    await expect(readGhToken(runner, 'linux')).rejects.toThrow(/Could not read a token/)
  })
})
