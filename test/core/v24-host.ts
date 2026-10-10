import type { AgentAction } from '@shared/agent'
import type { VpsExecResult } from '@shared/vps'
import type { V24ToolHost } from '../../src/main/v24-tools-wiring'

export interface FakeV24Host extends V24ToolHost {
  calls: Array<{ serverId: string; command: string }>
  audits: string[]
}

/** A scripted SSH host for the v2.4.1 wiring tests. */
export function fakeV24Host(
  options: {
    connected?: string[]
    reply?: (command: string) => Partial<VpsExecResult> | undefined
    servers?: Record<string, { host: string; port: number; username: string }>
    approveSudo?: boolean
  } = {}
): FakeV24Host {
  const calls: Array<{ serverId: string; command: string }> = []
  const audits: string[] = []
  const connected = options.connected ?? ['srv-1', 'srv-2']
  return {
    calls,
    audits,
    connectedServers: () => connected,
    resolveServer: async (id) => options.servers?.[id],
    exec: async (serverId, command) => {
      calls.push({ serverId, command })
      const override = options.reply?.(command)
      return { ok: true, stdout: '', stderr: '', exitCode: 0, ...override }
    },
    recordAudit: async (entry) => {
      audits.push(entry.detail ?? entry.type)
      return entry
    },
    ...(options.approveSudo !== undefined
      ? { requestSudoApproval: async () => options.approveSudo! }
      : {})
  }
}

export function action(name: string, args: Record<string, unknown>, valid = true): AgentAction {
  return {
    id: 'a1',
    name,
    arguments: args,
    rawArguments: JSON.stringify(args),
    valid,
    signature: `${name}:test`
  }
}
