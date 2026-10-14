/**
 * Which shell a local sandbox runs its commands in (v2.6.5).
 *
 * The agent emits POSIX shell commands — the tool descriptions, the system
 * prompt and the remote (SSH) path all assume `/bin/sh`. On Windows the local
 * sandbox used `cmd.exe`, which knows none of the tools those commands use
 * (`cat`, `ls`, `grep`, `sleep`, `printf`, `which`, `head`, ...). Every command
 * therefore failed and produced **empty stdout**, which the agent read as a
 * successful run with no output — the code-execution half of the app was
 * silently broken on its own primary target platform.
 *
 * Git for Windows ships a real `bash.exe`, and the app already requires `git` on
 * PATH for its GitHub features, so preferring it costs nothing. WSL's
 * `bash.exe` shim lives in `System32` and only works when a distribution is
 * installed, so it is deliberately skipped. `cmd.exe` remains the last resort
 * and is reported as the `cmd` dialect so callers can warn instead of pretending
 * POSIX commands will work.
 */
import * as path from 'node:path'

export type ShellDialect = 'posix' | 'cmd'

export interface SandboxShell {
  file: string
  args: (command: string) => string[]
  dialect: ShellDialect
}

const POSIX_SHELL: SandboxShell = {
  file: '/bin/sh',
  args: (command) => ['-c', command],
  dialect: 'posix'
}

/** `cmd.exe` is the fallback of last resort: it cannot run POSIX commands. */
export const CMD_SHELL: SandboxShell = {
  file: 'cmd.exe',
  args: (command) => ['/d', '/s', '/c', command],
  dialect: 'cmd'
}

/**
 * Candidate `bash.exe` locations for Git for Windows, in preference order.
 * Explicit install paths come first so they always beat a `bash.exe` on PATH.
 */
export function windowsPosixShellCandidates(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): string[] {
  const roots = [
    env['ProgramFiles'],
    env['ProgramW6432'],
    env['ProgramFiles(x86)'],
    env['LOCALAPPDATA'] ? path.join(env['LOCALAPPDATA'], 'Programs') : undefined
  ].filter((value): value is string => Boolean(value))

  const candidates: string[] = []
  for (const root of roots) {
    candidates.push(path.join(root, 'Git', 'bin', 'bash.exe'))
  }
  candidates.push(...bashOnPath(env))
  return [...new Set(candidates)]
}

/**
 * A `bash.exe` found on PATH, excluding the Windows `System32` shim (WSL), which
 * only works when a distribution happens to be installed.
 */
export function bashOnPath(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): string[] {
  const raw = env['PATH'] ?? env['Path'] ?? ''
  const found: string[] = []
  for (const dir of raw.split(path.delimiter).filter(Boolean)) {
    const normalized = dir.replace(/[\\/]+$/, '')
    if (/(^|[\\/])system32$/i.test(normalized)) continue
    if (/^[a-z]:\\windows$/i.test(normalized)) continue
    found.push(path.join(normalized, 'bash.exe'))
  }
  return found
}

/** First candidate that exists, as a POSIX shell descriptor. */
export function pickPosixShell(
  candidates: string[],
  exists: (candidate: string) => boolean = () => false
): SandboxShell | null {
  for (const candidate of candidates) {
    if (exists(candidate)) {
      return { file: candidate, args: (command) => ['-c', command], dialect: 'posix' }
    }
  }
  return null
}

/**
 * The shell for this platform: `/bin/sh` on POSIX, the best available POSIX
 * shell on Windows, and `cmd.exe` only when nothing better exists.
 */
export function resolveSandboxShell(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
  exists: (candidate: string) => boolean = () => false
): SandboxShell {
  if (platform !== 'win32') return POSIX_SHELL
  return pickPosixShell(windowsPosixShellCandidates(env), exists) ?? CMD_SHELL
}

/**
 * True when the resolved shell cannot run the POSIX commands the agent writes.
 * Callers surface this to the user instead of returning a silent empty result.
 */
export function shellDialectMismatch(shell: SandboxShell): boolean {
  return shell.dialect === 'cmd'
}

/**
 * The directory-listing command for a shell dialect (v2.6.5). `tools.ts` used to
 * choose `dir /b` from `process.platform`, which broke as soon as the Windows
 * sandbox started running under Git Bash: `dir` does not exist in a POSIX shell,
 * so `list_dir` returned `ok: false` on every call.
 */
export function listCommandFor(shell: SandboxShell): string {
  return shell.dialect === 'posix' ? 'ls -la' : 'dir /b'
}
