import { exec } from 'node:child_process'
import { existsSync } from 'node:fs'
import type { LocalShellResult } from '@shared/ui'
import { findSecretPathsInCommand } from '@shared/secret-paths'

export const DEFAULT_SHELL_TIMEOUT_MS = 30_000
const MAX_BUFFER = 4 * 1024 * 1024

/**
 * Runs a one-shot command through the host shell. Commands are user-initiated
 * from the chat terminal panel; there is no sandbox around them.
 */
export function runLocalCommand(
  command: string,
  options: { cwd?: string | null; timeoutMs?: number } = {}
): Promise<LocalShellResult> {
  // Secret Path Guard (v2.6.2, §5): refuse commands that reference credential
  // paths before they reach the shell.
  const secret = findSecretPathsInCommand(command)
  if (secret.length > 0) {
    return Promise.resolve({
      stdout: '',
      stderr: `Blocked: command references ${secret[0].reason}`,
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
        resolve({ stdout, stderr, exitCode })
      }
    )
  })
}
