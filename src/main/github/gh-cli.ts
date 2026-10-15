import type { CommandRunner } from '@core/sandbox/command-runner'
import { redactError } from '@core/agent/redact'

/**
 * Reuse the user's existing GitHub CLI login (v2.8.1).
 *
 * Reported: "I cannot connect to GitHub and it is very hard to connect to it."
 *
 * Verified causes: the device flow demands a hand-registered OAuth App plus a pasted client
 * id (and a *wrong* id produced an empty code box rather than an error), and the `gh` CLI —
 * which is very often already installed and authenticated — was used nowhere in the repo.
 * On the machine in question `gh 2.102.0` is logged in and its scopes (`repo`, `read:org`)
 * cover everything this app does.
 *
 * Everything here is a read: `gh --version`, `gh auth status` and `gh auth token`. It never
 * runs `gh auth login` and never touches the CLI's own credential store, so disconnecting
 * the app cannot break the user's other tools. The token is handed straight to the caller
 * and must never be logged — the thrown errors below are passed through `redactError`.
 */
export interface GhCliDetection {
  available: boolean
  version?: string
  login?: string
  host?: string
  scopes?: string[]
  /** Why it is unusable: 'not installed' | 'not logged in' | a redacted stderr. */
  reason?: string
}

/** A Windows install whose directory is often missing from the process PATH. */
export const GH_FALLBACK_PATHS: readonly string[] = [
  'C:\\Program Files\\GitHub CLI\\gh.exe',
  'C:\\Program Files (x86)\\GitHub CLI\\gh.exe'
]

const PROBE_TIMEOUT_MS = 10_000

/** `gh version 2.102.0 (2026-09-30)` → `2.102.0`. */
export function parseGhVersion(stdout: string): string | undefined {
  return /gh version (\S+)/.exec(stdout)?.[1]
}

/**
 * Parse `gh auth status`. Tolerates the multi-account 2.x layout:
 *
 *     github.com
 *       ✓ Logged in to github.com account Arashtahmasbi3 (keyring)
 *       - Active account: true
 *       - Token scopes: 'admin:public_key', 'gist', 'read:org', 'repo'
 */
export function parseGhAuthStatus(
  stdout: string
): { login: string; host: string; scopes: string[] } | null {
  const loginMatch = /Logged in to (\S+) account (\S+)/.exec(stdout)
  if (!loginMatch) return null
  const host = loginMatch[1]
  const login = loginMatch[2]
  const scopesMatch = /Token scopes:\s*(.+)/.exec(stdout)
  const scopes = scopesMatch
    ? scopesMatch[1]
        .split(',')
        .map((scope) => scope.trim().replace(/^['"]|['"]$/g, ''))
        .filter((scope) => scope !== '')
    : []
  return { login, host, scopes }
}

/** One probe, reporting whether the file even exists rather than throwing on ENOENT. */
async function probe(
  runner: CommandRunner,
  file: string,
  args: string[]
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  try {
    const result = await runner.run(file, args, {
      timeoutMs: PROBE_TIMEOUT_MS,
      maxOutputBytes: 64 * 1024
    })
    return { ok: result.exitCode === 0, stdout: result.stdout, stderr: result.stderr }
  } catch (error) {
    // `ChildProcessRunner` rejects on a spawn failure (ENOENT when gh is absent), so the
    // absence of the CLI is a value here, not an exception.
    return {
      ok: false,
      stdout: '',
      stderr: error instanceof Error ? error.message : String(error)
    }
  }
}

/** The candidate executables, most likely first. */
export function ghCandidates(platform: NodeJS.Platform = process.platform): string[] {
  // gh ships as `gh` (and `gh.exe` on Windows, where spawn resolves both) on PATH; the
  // absolute paths cover a Windows install whose directory is missing from PATH.
  return platform === 'win32' ? ['gh', ...GH_FALLBACK_PATHS] : ['gh']
}

/**
 * Detect an existing, authenticated `gh` login. Never throws; ENOENT means "not installed".
 */
export async function detectGhCli(
  runner: CommandRunner,
  platform: NodeJS.Platform = process.platform
): Promise<GhCliDetection> {
  let lastFailure = ''

  for (const candidate of ghCandidates(platform)) {
    const version = await probe(runner, candidate, ['--version'])
    if (!version.ok) {
      lastFailure = version.stderr
      continue
    }
    const versionNumber = parseGhVersion(version.stdout)

    const status = await probe(runner, candidate, ['auth', 'status'])
    const parsed = parseGhAuthStatus(`${status.stdout}\n${status.stderr}`)
    if (!parsed) {
      return {
        available: true,
        ...(versionNumber ? { version: versionNumber } : {}),
        reason: 'not logged in'
      }
    }

    return {
      available: true,
      ...(versionNumber ? { version: versionNumber } : {}),
      login: parsed.login,
      host: parsed.host,
      scopes: parsed.scopes
    }
  }

  return {
    available: false,
    reason: lastFailure === '' ? 'not installed' : redactError(lastFailure).slice(0, 200)
  }
}

/**
 * Read the CLI's token for the caller to validate and store. The value is never logged and
 * never put into an error message.
 */
export async function readGhToken(
  runner: CommandRunner,
  platform: NodeJS.Platform = process.platform
): Promise<string> {
  let lastFailure = ''
  for (const candidate of ghCandidates(platform)) {
    const result = await probe(runner, candidate, ['auth', 'token'])
    if (result.ok) {
      const token = result.stdout.trim()
      if (token !== '') return token
      lastFailure = 'gh returned an empty token'
      continue
    }
    lastFailure = result.stderr
  }
  throw new Error(
    `Could not read a token from the GitHub CLI (${redactError(lastFailure).slice(0, 200) || 'not installed'}). Sign in with "gh auth login", or use an access token instead.`
  )
}
