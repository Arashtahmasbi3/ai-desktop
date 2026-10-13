import { exec } from 'node:child_process'
import { existsSync } from 'node:fs'
import type { LocalShellResult } from '@shared/ui'
import { checkDenyList } from '@core/agent/deny-list'
import { findSecretPathsInCommand } from '@shared/secret-paths'

export const DEFAULT_SHELL_TIMEOUT_MS = 30_000
const MAX_BUFFER = 4 * 1024 * 1024
/** A terminal command longer than this is refused outright. */
const MAX_COMMAND_LENGTH = 8192

export interface LocalShellOptions {
  cwd?: string | null
  timeoutMs?: number
  /**
   * Optional audit sink (v2.6.5). The chat terminal used to be the one execution
   * path with no audit entry at all, so nothing recorded what ran on the user's
   * own machine.
   */
  audit?: (entry: { ok: boolean; command: string; detail?: string }) => void
}

/**
 * Runs a one-shot command through the host shell. Commands are user-initiated
 * from the chat terminal panel; there is no sandbox around them, so the shared
 * guards run first (v2.6.5):
 *
 *  - the secret-path guard refuses commands that reference credential paths;
 *  - the deny list refuses the catastrophic set (`rm -rf /`, `mkfs`, `dd of=/dev/…`,
 *    `sudo reboot`, piping a download into a shell, ...). The deny list is
 *    deliberately over-eager, and a false positive only asks the user to
 *    rephrase, so it is applied here unconditionally rather than behind the
 *    opt-in Settings toggle the backlog proposed;
 *  - every attempt is reported to the audit sink.
 */
export function runLocalCommand(
  command: string,
  options: LocalShellOptions = {}
): Promise<LocalShellResult> {
  const record = (ok: boolean, detail: string): void => {
    options.audit?.({ ok, command, detail })
  }

  if (typeof command !== 'string' || command.trim() === '') {
    record(false, 'rejected: empty command')
    return Promise.resolve({
      stdout: '',
      stderr: 'Blocked: empty command',
      exitCode: 126,
      blocked: true
    })
  }
  if (command.length > MAX_COMMAND_LENGTH) {
    record(false, 'rejected: command too long')
    return Promise.resolve({
      stdout: '',
      stderr: `Blocked: command exceeds ${MAX_COMMAND_LENGTH} characters`,
      exitCode: 126,
      blocked: true
    })
  }

  // Secret Path Guard (v2.6.2, §5): refuse commands that reference credential
  // paths before they reach the shell.
  const secret = findSecretPathsInCommand(command)
  if (secret.length > 0) {
    record(false, `blocked: ${secret[0].reason}`)
    return Promise.resolve({
      stdout: '',
      stderr: `Blocked: command references ${secret[0].reason}`,
      exitCode: 126,
      blocked: true
    })
  }

  // v2.6.5: the same deny list every remote command passes. Previously the local
  // terminal skipped it entirely, so `window.api.shell.exec('rm -rf /')` from a
  // compromised renderer had no guard at all.
  const denial = checkDenyList(command)
  if (denial.blocked) {
    record(false, `blocked by policy: ${denial.reason}`)
    return Promise.resolve({
      stdout: '',
      stderr: `Blocked by policy: ${denial.reason}`,
      exitCode: 126,
      blocked: true
    })
  }

  const cwd = options.cwd && existsSync(options.cwd) ? options.cwd : undefined
  const timeout = options.timeoutMs ?? DEFAULT_SHELL_TIMEOUT_MS
  return new Promise((resolve) => {
    exec(
      command,
      { cwd, timeout, windowsHide: true, maxBuffer: MAX_BUFFER },
      (error, stdout, stderr) => {
        let exitCode = 0
        if (error) {
          const code = (error as { code?: number | string }).code
          exitCode = typeof code === 'number' ? code : error.killed ? 124 : 1
        }
        record(exitCode === 0, `exit ${exitCode}`)
        resolve({ stdout, stderr, exitCode })
      }
    )
  })
}
