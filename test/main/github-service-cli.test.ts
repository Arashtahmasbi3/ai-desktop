import { beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { GitHubService } from '@main/github/service'
import type { CommandRunner } from '@core/sandbox/command-runner'
import type { FetchLike } from '@shared/types'
import { XorCipher } from '../helpers/fake-cipher'
import { FakeRunner, runResult } from '../helpers/fake-runner'

/**
 * v2.8.1 — "I cannot connect to GitHub and it is very hard to connect to it."
 *
 * The reporting machine already had `gh` installed and authenticated, and the app used it
 * nowhere: the only paths were "register an OAuth App and paste its client id" (the device
 * flow) or a hand-made PAT. These cases pin the one-click path at the *service* level — the
 * `gh` parsing itself is covered in `github-cli.test.ts`.
 *
 * The two invariants that matter most:
 *  - the token is validated with `GET /user` *before* anything is persisted, and is stored
 *    encrypted (`safeStorage` in production, a fake cipher here) — never in plaintext;
 *  - a CLI failure is actionable and makes **no network call**, and nothing here ever runs
 *    `gh auth logout`, so disconnecting the app cannot break the user's own CLI login.
 */

let file: string

beforeEach(() => {
  file = `/tmp/ai-desktop-github-cli-${Math.random().toString(36).slice(2)}.json`
})

const GH_VERSION = 'gh version 2.102.0 (2026-09-30)\n'
const GH_STATUS = `github.com
  ✓ Logged in to github.com account Arashtahmasbi3 (keyring)
  - Active token: gho_************************************
  - Token scopes: 'read:org', 'repo'
`

/** Captured verbatim from the reporting machine: the CLI is installed *and* authenticated. */
function authenticatedRunner(token = 'gho_cli_token_value'): FakeRunner {
  return new FakeRunner((_file, args) => {
    if (args[0] === '--version') return runResult({ stdout: GH_VERSION })
    if (args[0] === 'auth' && args[1] === 'status') return runResult({ stdout: GH_STATUS })
    if (args[0] === 'auth' && args[1] === 'token') return runResult({ stdout: `${token}\n` })
    return runResult({ exitCode: 1, stderr: `unexpected call ${args.join(' ')}` })
  })
}

interface Calls {
  urls: string[]
  auths: (string | undefined)[]
}

/** A `fetch` that only answers `GET /user`, recording every request for assertions. */
function recordingFetch(calls: Calls, login = 'Arashtahmasbi3'): FetchLike {
  return (async (input: string, init?: RequestInit) => {
    calls.urls.push(input)
    calls.auths.push((init?.headers as Record<string, string> | undefined)?.Authorization)
    if (input.endsWith('/user')) {
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({ login }),
        text: async () => JSON.stringify({ login })
      } as unknown as Response
    }
    return {
      ok: false,
      status: 404,
      statusText: 'Not Found',
      json: async () => ({ message: 'not found' }),
      text: async () => 'not found'
    } as unknown as Response
  }) as unknown as FetchLike
}

function make(fetchImpl: FetchLike, ghRunner?: CommandRunner): GitHubService {
  return new GitHubService({
    file,
    cipher: new XorCipher(),
    fetchImpl,
    exec: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
    ...(ghRunner ? { ghRunner } : {})
  })
}

describe('GitHubService.connectWithCli (v2.8.1)', () => {
  it('reuses the CLI token through setToken: validated with /user before persisting', async () => {
    const calls: Calls = { urls: [], auths: [] }
    const service = make(recordingFetch(calls), authenticatedRunner())

    const status = await service.connectWithCli()

    // Validation happened — and against the real endpoint, with the CLI's token on the header.
    expect(calls.urls.some((url) => url.endsWith('/user'))).toBe(true)
    expect(calls.auths.some((auth) => auth === 'Bearer gho_cli_token_value')).toBe(true)
    expect(status.connected).toBe(true)
    expect(status.user?.login).toBe('Arashtahmasbi3')
    // Provenance is recorded, so the UI can say "via GitHub CLI" instead of guessing.
    expect(status.source).toBe('gh-cli')
    // ...and it survives a reload of the persisted file.
    expect((await service.status()).source).toBe('gh-cli')
  })

  it('stores the token encrypted: the persisted file holds no plaintext token', async () => {
    const calls: Calls = { urls: [], auths: [] }
    const service = make(recordingFetch(calls), authenticatedRunner())

    await service.connectWithCli()

    const persisted = readFileSync(file, 'utf8')
    expect(persisted).not.toContain('gho_cli_token_value')
    expect(persisted).toContain('tokenEnc')
    expect(persisted).toContain('"source": "gh-cli"')
    // The renderer-facing status never carries the token either.
    expect(JSON.stringify(await service.status())).not.toContain('gho_')
  })

  it('fails actionably with NO network call when the CLI cannot provide a token', async () => {
    const calls: Calls = { urls: [], auths: [] }
    const runner = new FakeRunner((_file, args) =>
      args[0] === '--version'
        ? runResult({ stdout: GH_VERSION })
        : runResult({ exitCode: 1, stderr: 'You are not logged into any GitHub hosts.' })
    )
    const service = make(recordingFetch(calls), runner)

    await expect(service.connectWithCli()).rejects.toThrow(/Could not read a token/)
    // The point of the test: a dead CLI must not even try api.github.com.
    expect(calls.urls).toEqual([])
    expect((await service.status()).connected).toBe(false)
  })

  it('rejects a CLI token GitHub refuses, leaving the user disconnected', async () => {
    const service = make(
      (async () =>
        ({
          ok: false,
          status: 401,
          statusText: 'Unauthorized',
          json: async () => ({ message: 'Bad credentials' }),
          text: async () => 'Bad credentials'
        }) as unknown as Response) as unknown as FetchLike,
      authenticatedRunner()
    )

    const thrown = (await service.connectWithCli().catch((error: unknown) => error)) as Error
    expect(thrown.message).toMatch(/401/)
    // A secret must never reach an error message or a toast.
    expect(thrown.message).not.toContain('gho_cli_token_value')
    expect((await service.status()).connected).toBe(false)
  })

  it('never probes the CLI at load(): detection stays lazy', async () => {
    const runner = authenticatedRunner()
    const service = make(recordingFetch({ urls: [], auths: [] }), runner)

    await service.load()

    expect(runner.calls).toEqual([])
  })
})

describe('GitHubService.detectCli (v2.8.1)', () => {
  it('reports the CLI login, host, scopes and version', async () => {
    const runner = authenticatedRunner()
    const service = make(recordingFetch({ urls: [], auths: [] }), runner)

    await expect(service.detectCli()).resolves.toEqual({
      available: true,
      login: 'Arashtahmasbi3',
      host: 'github.com',
      scopes: ['read:org', 'repo'],
      version: '2.102.0'
    })
    // A pure read: no token fetch, no `/auth/token`.
    expect(runner.calls.map((call) => call.args)).toEqual([['--version'], ['auth', 'status']])
  })

  it('reports "not installed" as a value, not an exception', async () => {
    const runner = new FakeRunner(() => {
      throw new Error('spawn gh ENOENT')
    })
    const service = make(recordingFetch({ urls: [], auths: [] }), runner)

    await expect(service.detectCli()).resolves.toMatchObject({
      available: false,
      reason: 'spawn gh ENOENT'
    })
  })

  it('is honest when no runner is wired at all', async () => {
    const service = make(recordingFetch({ urls: [], auths: [] }))
    await expect(service.detectCli()).resolves.toEqual({
      available: false,
      reason: 'GitHub CLI detection is not configured'
    })
  })
})

describe('GitHubService.logout (v2.8.1)', () => {
  it('drops only our encrypted copy and never invokes the gh runner', async () => {
    const runner = authenticatedRunner()
    const service = make(recordingFetch({ urls: [], auths: [] }), runner)
    await service.connectWithCli()
    const callsAtConnect = runner.calls.length

    const status = await service.logout()

    expect(status.connected).toBe(false)
    expect(status.source).toBeUndefined()
    // The whole point: disconnecting AI Desktop is not `gh auth logout`.
    expect(runner.calls.length).toBe(callsAtConnect)
    expect(runner.calls.some((call) => call.args.includes('logout'))).toBe(false)
  })
})
