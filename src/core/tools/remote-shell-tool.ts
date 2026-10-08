import type { ToolDefinition } from '@shared/types'
import type { VpsExecResult } from '@shared/vps'
import { checkDenyList } from '@core/agent/deny-list'

/** Tool the agent can call to run a command on a connected VPS. */
export const REMOTE_SHELL_TOOL: ToolDefinition = {
  name: 'remote_shell',
  description:
    'Run a shell command on a connected VPS over SSH. Dangerous commands are blocked by policy and every command is audited.',
  parameters: {
    type: 'object',
    properties: {
      server_id: { type: 'string', description: 'Id of a connected VPS server' },
      command: { type: 'string', description: 'Shell command to run on the remote host' }
    },
    required: ['server_id', 'command'],
    additionalProperties: false
  }
}

export interface RemoteShellDeps {
  exec(serverId: string, command: string): Promise<VpsExecResult>
  connectedServers(): string[]
}

export interface RemoteShellResult {
  ok: boolean
  content: string
  blocked?: boolean
}

/**
 * Guarded entry point for the agent. Applies the deny list again (defence in
 * depth — the manager also enforces it) and refuses unknown servers.
 */
export async function executeRemoteShell(
  deps: RemoteShellDeps,
  args: { server_id?: unknown; command?: unknown }
): Promise<RemoteShellResult> {
  const serverId = String(args.server_id ?? '').trim()
  const command = String(args.command ?? '').trim()
  const connected = deps.connectedServers()

  if (!serverId) {
    return {
      ok: false,
      content: `server_id is required. Connected: ${connected.join(', ') || 'none'}`
    }
  }
  if (!connected.includes(serverId)) {
    return { ok: false, content: `Server ${serverId} is not connected.` }
  }
  const denial = checkDenyList(command)
  if (denial.blocked) {
    return { ok: false, blocked: true, content: `Blocked by policy: ${denial.reason}` }
  }
  const result = await deps.exec(serverId, command)
  if (result.blocked) {
    return { ok: false, blocked: true, content: `Blocked by policy: ${result.reason}` }
  }
  if (result.rateLimited) {
    return { ok: false, content: `Rate limited: ${result.reason}` }
  }
  const output = `${result.stdout}${result.stderr}`.trim()
  return { ok: result.ok, content: output || `exit ${result.exitCode}` }
}
