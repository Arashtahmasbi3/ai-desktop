/**
 * Sequentially run remote commands, stopping at the first failure (v2.3.3, D).
 *
 * Shared by git-setup (B.1) and the install assistant (C.3) so both honour the
 * same "abort on error" contract — and so that contract is unit-testable with an
 * injected exec instead of a live SSH session.
 */

import type { WorkspaceExec } from './workspace-detect'

export interface CommandRunOutcome {
  ran: string[]
  output: string
}

export class RemoteCommandError extends Error {
  constructor(
    public readonly command: string,
    public readonly detail: string
  ) {
    super(`Command failed: ${command}${detail ? `\n${detail}` : ''}`)
    this.name = 'RemoteCommandError'
  }
}

export async function runRemoteCommands(
  exec: WorkspaceExec,
  commands: readonly string[]
): Promise<CommandRunOutcome> {
  const ran: string[] = []
  const output: string[] = []
  for (const command of commands) {
    const result = await exec(command)
    ran.push(command)
    const text = `${result.stdout}${result.stderr ?? ''}`.trim()
    if (result.ok) {
      if (text) output.push(text)
      continue
    }
    throw new RemoteCommandError(command, text)
  }
  return { ran, output: output.join('\n') }
}
