import type { ApprovalMode } from '@shared/approval'

/**
 * What the next run is allowed to do (v4.2, U3-4).
 *
 * The status bar printed the approval mode alone, which answers half of the question: "auto-write"
 * means something different in a local project than on a server, and plan mode overrides the
 * approval mode entirely because it runs no tools at all. This derives the whole answer from the
 * store's own state — `planMode`, `settings.approvalMode` and the active project — so the footer
 * reports the run rather than a guess about it.
 *
 * Precedence is stated once, here: **plan mode wins over the approval mode**, because a run in plan
 * mode never reaches the approval gate.
 */
export type RunAccessMode = 'plan' | ApprovalMode

export type RunAccessScope = 'local' | 'remote' | 'none'

export interface RunAccessProject {
  type: 'local' | 'remote'
  vpsId?: string
}

export interface RunAccessInput {
  planMode: boolean
  approvalMode: ApprovalMode
  project?: RunAccessProject | undefined
  /** The active project's server name, when `vpsServers` knows it. */
  serverName?: string | undefined
}

export interface RunAccess {
  scope: RunAccessScope
  mode: RunAccessMode
  /** One-word scope: "Local" / "Remote" / "No project". */
  scopeKey: string
  /** The mode's short name: "Plan" / "Ask" / "Auto-write" / "Full access". */
  modeKey: string
  /**
   * The full sentence, as keys: where this run applies, then what it may do. The component joins
   * them with a space into one tooltip — a `<title>`-style tooltip cannot be more than one line, and
   * splitting it into two tooltips would make half of it unreachable.
   */
  titleKeys: string[]
  /** Named in the remote sentence, so the tooltip says *which* server. */
  serverName?: string
}

const MODE_KEY: Record<RunAccessMode, string> = {
  plan: 'statusBar.accessPlan',
  ask: 'statusBar.accessAsk',
  'auto-write': 'statusBar.accessAutoWrite',
  full: 'statusBar.accessFull'
}

const MODE_TITLE_KEY: Record<RunAccessMode, string> = {
  plan: 'statusBar.accessTitlePlan',
  ask: 'statusBar.accessTitleAsk',
  'auto-write': 'statusBar.accessTitleAutoWrite',
  full: 'statusBar.accessTitleFull'
}

export function deriveRunAccess(input: RunAccessInput): RunAccess {
  const scope: RunAccessScope =
    input.project === undefined ? 'none' : input.project.type === 'remote' ? 'remote' : 'local'
  // Plan mode first: it is the one state in which the approval mode is never consulted.
  const mode: RunAccessMode = input.planMode ? 'plan' : input.approvalMode

  const scopeKey =
    scope === 'local'
      ? 'statusBar.accessScopeLocal'
      : scope === 'remote'
        ? 'statusBar.accessScopeRemote'
        : 'statusBar.accessScopeNone'

  const scopeTitleKey =
    scope === 'local'
      ? 'statusBar.accessTitleLocal'
      : scope === 'none'
        ? 'statusBar.accessTitleNone'
        : input.serverName
          ? 'statusBar.accessTitleRemote'
          : 'statusBar.accessTitleRemoteNoServer'

  return {
    scope,
    mode,
    scopeKey,
    modeKey: MODE_KEY[mode],
    titleKeys: [scopeTitleKey, MODE_TITLE_KEY[mode]],
    ...(scope === 'remote' && input.serverName ? { serverName: input.serverName } : {})
  }
}
