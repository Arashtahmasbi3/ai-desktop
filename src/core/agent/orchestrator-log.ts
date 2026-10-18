/**
 * The structured log sink the orchestrator hands to its helper modules (F0-4).
 *
 * A helper may import from @shared and from other core modules, never from the
 * orchestrator itself. Passing the bound `log` keeps that direction one-way, so the
 * split can never become a cycle.
 */
import type { AgentLogEntry, AgentLogLevel } from '@shared/agent'

export type OrchestratorLog = (
  level: AgentLogLevel,
  event: string,
  runId: string,
  extra?: Omit<Partial<AgentLogEntry>, 'ts' | 'level' | 'event' | 'runId'>
) => void
