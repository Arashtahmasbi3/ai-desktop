import type { ToolDefinition } from '@shared/types'
import type { VpsExecResult } from '@shared/vps'
import type { AgentAction, AgentToolResult } from '@shared/agent'
import type { ToolExecutor, ToolExecOptions } from '@core/agent/tools'
import type { DiagnosticPolicy } from '@core/remote/diagnostic-policy'
import { formatDiagnosis, runCrashDiagnosis } from '@core/agent/crash-diagnosis'

/** Tool the agent calls to run the structured crash-diagnosis probes (v2.5.6). */
export const DIAGNOSE_CRASH_TOOL: ToolDefinition = {
  name: 'diagnose_crash',
  description:
    'Run a fixed set of read-only diagnostics on the connected remote project (process managers, logs, resources, network) and return a probable cause with recommendations. Call this instead of guessing commands when the user asks why a project is crashing or failing.',
  parameters: {
    type: 'object',
    properties: {
      server_id: { type: 'string', description: 'Id of a connected VPS server' }
    },
    additionalProperties: false
  }
}

export interface CrashDiagnosisToolDeps {
  exec(serverId: string, command: string, timeoutMs?: number): Promise<VpsExecResult>
  connectedServers(): string[]
  /** Absolute root of the active project, substituted into the project probes. */
  projectRoot?: string
  /** Read-only widening while Diagnostic Mode is on (v2.5.3). */
  diagnostic?: DiagnosticPolicy | null
}

/**
 * Bridges the agent's `diagnose_crash` action to a connected VPS. The probes are
 * fixed and read-only; the pinned server (chosen in the chat header) wins over
 * any `server_id` the model supplies, so a diagnosis can never touch another host.
 */
export class CrashDiagnosisToolExecutor implements ToolExecutor {
  constructor(
    private readonly deps: CrashDiagnosisToolDeps,
    private readonly pinnedServerId?: string
  ) {}

  async execute(action: AgentAction, _options: ToolExecOptions = {}): Promise<AgentToolResult> {
    const startedAt = Date.now()
    const base = {
      actionId: action.id,
      name: action.name,
      attempts: 1,
      durationMs: Date.now() - startedAt
    }

    if (action.name !== DIAGNOSE_CRASH_TOOL.name) {
      return { ...base, ok: false, output: '', error: `Unknown tool "${action.name}"`, code: 'unknown_tool' }
    }
    if (!action.valid) {
      return {
        ...base,
        ok: false,
        output: '',
        error: `${action.name} received malformed JSON arguments`,
        code: 'invalid_arguments'
      }
    }

    const requested = action.arguments.server_id
    const serverId = this.pinnedServerId ?? (typeof requested === 'string' ? requested : '')
    if (!serverId) {
      return {
        ...base,
        ok: false,
        output: '',
        error: `server_id is required. Connected: ${this.deps.connectedServers().join(', ') || 'none'}`,
        code: 'invalid_arguments'
      }
    }
    if (!this.deps.connectedServers().includes(serverId)) {
      return {
        ...base,
        ok: false,
        output: '',
        error: `Server ${serverId} is not connected.`,
        serverId,
        code: 'remote_error'
      }
    }

    const result = await runCrashDiagnosis({
      exec: (command, timeoutMs) => this.deps.exec(serverId, command, timeoutMs),
      ...(this.deps.projectRoot ? { projectRoot: this.deps.projectRoot } : {}),
      ...(this.deps.diagnostic ? { diagnostic: this.deps.diagnostic } : {})
    })

    return {
      ...base,
      ok: true,
      output: formatDiagnosis(result),
      serverId,
      ...(this.deps.projectRoot ? { cwd: this.deps.projectRoot } : {}),
      durationMs: Date.now() - startedAt
    }
  }
}
