/**
 * Tool exposure (v2.6.2 T2.4).
 *
 * `resolveSessionProfile` decides *whether* a run may write; this module decides
 * *which tools* the model is offered, and how far its read-only introspection may
 * reach on the host. It is the bridge between the Session Profile (policy up) and
 * `AgentOrchestrator.toolPolicy` + the remote path guard (mechanisms down), so the
 * "product × environment" matrix lives in one auditable place.
 *
 * Pure and dependency-free (except shared types): no main, no SSH, no clock.
 */
import {
  DEFAULT_PROJECT_ENVIRONMENT,
  isProjectEnvironment,
  type ProjectEnvironment
} from '@shared/project-metadata'
import {
  NAMED_DIAGNOSTIC_TOOL_NAMES,
  READ_ONLY_TOOL_NAMES,
  type ResolvedProfile
} from '@shared/profile'

export type ToolExposureMode = 'full' | 'read-only' | 'plan-only' | 'diagnostics-only'

/**
 * Absolute host roots Investigate may read in addition to the project root.
 *
 * Development is a disposable box, so read-only analysis may look anywhere.
 * Staging is narrowed to the places a failure actually shows up (logs, process
 * state, temp). Production exposes *no* extra root: only named diagnostics may
 * touch the host, so the model never chooses a path (T2.4 / sprint §2.3).
 */
export const ENVIRONMENT_READ_ROOTS: Record<ProjectEnvironment, readonly string[]> = {
  development: ['/'],
  staging: ['/var/log', '/proc', '/tmp'],
  production: []
}

export interface ToolExposure {
  mode: ToolExposureMode
  /** Tools the model may call; `null` means "the full set, unfiltered". */
  tools: ReadonlySet<string> | null
  /** Extra absolute read roots for path-based tools (empty = project root only). */
  readRoots: readonly string[]
  /** True when only the named diagnostics may read the host. */
  diagnosticsOnly: boolean
}

const EMPTY: ReadonlySet<string> = new Set<string>()

function environmentOf(profile: ResolvedProfile): ProjectEnvironment {
  return isProjectEnvironment(profile.environment)
    ? profile.environment
    : DEFAULT_PROJECT_ENVIRONMENT
}

/**
 * Map an effective profile to the tool set and read reach it grants.
 *
 * Plan-only is checked first: it is the strictest Investigate scope and yields no
 * tools at all, regardless of environment. Develop/Deploy/Elevated keep the full
 * set (`tools: null`) — their safety comes from approval + HostPolicy, not from
 * hiding tools.
 */
export function resolveToolExposure(profile: ResolvedProfile): ToolExposure {
  if (profile.planMode || profile.investigateScope === 'plan-only') {
    return { mode: 'plan-only', tools: EMPTY, readRoots: [], diagnosticsOnly: false }
  }

  if (profile.profile === 'investigate') {
    const environment = environmentOf(profile)
    if (environment === 'production') {
      return {
        mode: 'diagnostics-only',
        tools: NAMED_DIAGNOSTIC_TOOL_NAMES,
        readRoots: [],
        diagnosticsOnly: true
      }
    }
    return {
      mode: 'read-only',
      tools: READ_ONLY_TOOL_NAMES,
      readRoots: ENVIRONMENT_READ_ROOTS[environment],
      diagnosticsOnly: false
    }
  }

  return { mode: 'full', tools: null, readRoots: [], diagnosticsOnly: false }
}

/** True when the exposure permits a tool. `null` tool set means "all". */
export function allowsTool(exposure: ToolExposure, toolName: string): boolean {
  return exposure.tools === null || exposure.tools.has(toolName)
}

/**
 * A `toolPolicy` for the orchestrator, or `undefined` when nothing is filtered.
 * Passing `undefined` to the orchestrator means "expose everything", which is the
 * Develop/Deploy/Elevated case.
 */
export function toolPolicyFor(
  exposure: ToolExposure
): ((toolName: string) => boolean) | undefined {
  if (exposure.mode === 'full') return undefined
  return (toolName) => allowsTool(exposure, toolName)
}
