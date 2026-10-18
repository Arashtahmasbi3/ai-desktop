import type { AgentAction } from '@shared/agent'
import type { ApprovalMode, ApprovalOutcome, ApprovalReason } from '@shared/approval'
import type { ApprovedCommands } from '@core/agent/approved-commands'
import { DEFAULT_APPROVAL_MODE } from '@core/agent/approval'
import { createApprovedPlan, shouldAutoApprove } from '@core/agent/approved-plan'
import type { AuditTrail } from '@core/agent/audit-trail'
import { auditLineFromDecision, auditLineFromPreflightOverride } from '@core/agent/audit-trail'
import type { RunGoalContext } from '@core/agent/goal-context'
import type { AppSettings, Persistence } from '@core/agent/persistence'
import { PLAN_TRUST_METADATA_KEY, type PlanTrustRegistry } from '@core/agent/plan-trust'
import { preflight, preflightActionFor } from '@core/agent/preflight'
import type { PreflightResult, PreflightTier } from '@core/agent/preflight'
import { extractPreflightReason } from '@core/agent/preflight-override'
import type { SessionStore } from '@core/agent/session-store'
import { classifyImpact, describeAction, recordsCheckpoints } from '@shared/decision-checkpoint'
import type { CheckpointMode } from '@shared/decision-checkpoint'
import type { ApprovedPlan, Plan, PlanDecision, PlanScopeContext, PlanWarning } from '@shared/plan'
import { PLAN_REAPPROVE_MESSAGE } from '@shared/plan'
import type { PreflightChoice, PreflightPromptTier } from '@shared/preflight'
import type { ResolvedProfile } from '@shared/profile'
import type { TraceDecision } from '@shared/trace'
import type { AgentRunRequest, AgentEvent, ProjectRecord } from '@shared/ui'
import { createApprovalGate, describeApprovalReason } from '../approval-gate'
import type { CheckpointStore } from '../checkpoint-store'
import type { RemoteHost } from './remote-runtime'

/**
 * The per-run gates: approval, plan trust, preflight and the audit trail (F0-4).
 *
 * Split out of `agent-service.ts`. Every gate is built once per run from the same
 * posture, so a run cannot half-decide: the approval mode, the plan mode and the
 * checkpoint mode are all resolved here, in one place, before the orchestrator exists.
 */

export interface RunGateInput {
  activeProject: ProjectRecord | undefined
  request: AgentRunRequest
  runId: string
  /** v2.6.1 Fix 3: trust and memory are scoped to the chat, not the run. */
  sessionKey: string
  profileState: ResolvedProfile | undefined
  settings: AppSettings
  goalContext: RunGoalContext
  audit: AuditTrail | undefined
}

export interface RunGates {
  approvalMode: ApprovalMode
  planMode: boolean
  approvalGate?: (action: AgentAction) => Promise<boolean>
  planGate?: (plan: Plan, warnings: PlanWarning[]) => Promise<PlanDecision>
  preflightGate?: (action: AgentAction) => Promise<PreflightResult | undefined>
  preflightOverride?: (
    action: AgentAction,
    result: PreflightResult,
    tier: PreflightTier,
    context: { attempt: number }
  ) => Promise<PreflightChoice>
  onDecision?: (decision: TraceDecision) => void
}

export interface RunGateFactoryDeps {
  persistence: Persistence
  sessionStore: SessionStore
  planTrust: PlanTrustRegistry
  emit: (event: AgentEvent) => void
  now: () => number
  vps?: RemoteHost
  approvedCommands?: ApprovedCommands
  checkpoints?: CheckpointStore
  requestApproval?: (
    runId: string,
    action: AgentAction,
    reason?: ApprovalReason
  ) => Promise<ApprovalOutcome>
  requestPlan?: (runId: string, plan: Plan, warnings: PlanWarning[]) => Promise<PlanDecision>
  requestPreflight?: (
    runId: string,
    action: AgentAction,
    result: PreflightResult,
    tier: PreflightPromptTier,
    context: { attempt: number }
  ) => Promise<PreflightChoice>
}

export class RunGateFactory {
  private readonly persistence: Persistence
  private readonly sessionStore: SessionStore
  private readonly planTrust: PlanTrustRegistry
  private readonly emit: (event: AgentEvent) => void
  private readonly now: () => number
  private readonly vps?: RemoteHost
  private readonly approvedCommands?: ApprovedCommands
  private readonly checkpoints?: CheckpointStore
  private readonly requestApproval?: (
    runId: string,
    action: AgentAction,
    reason?: ApprovalReason
  ) => Promise<ApprovalOutcome>
  private readonly requestPlan?: (
    runId: string,
    plan: Plan,
    warnings: PlanWarning[]
  ) => Promise<PlanDecision>
  private readonly requestPreflight?: (
    runId: string,
    action: AgentAction,
    result: PreflightResult,
    tier: PreflightPromptTier,
    context: { attempt: number }
  ) => Promise<PreflightChoice>

  constructor(deps: RunGateFactoryDeps) {
    this.persistence = deps.persistence
    this.sessionStore = deps.sessionStore
    this.planTrust = deps.planTrust
    this.emit = deps.emit
    this.now = deps.now
    if (deps.vps) this.vps = deps.vps
    if (deps.approvedCommands) this.approvedCommands = deps.approvedCommands
    if (deps.checkpoints) this.checkpoints = deps.checkpoints
    this.requestApproval = deps.requestApproval
    this.requestPlan = deps.requestPlan
    this.requestPreflight = deps.requestPreflight
  }

  /** Build every gate this run will be judged by, in the order they are consulted. */
  async assemble(input: RunGateInput): Promise<RunGates> {
    const { activeProject, request, runId, sessionKey, profileState, settings, goalContext } = input
    // P0-5 (v2.6.2): approval comes from the Session Profile resolved at the top
    // of this run; the legacy `settings.approvalMode` remains only as a fallback
    // for callers that did not inject a Session Profile service (older tests).
    const approvalMode =
      profileState?.approvalMode ?? settings.approvalMode ?? DEFAULT_APPROVAL_MODE
    const planMode = request.planMode ?? profileState?.planMode ?? settings.planModeDefault ?? false
    /*
     * v3.1: read the checkpoint mode once for the whole run. A run that changed its mind halfway
     * would be worse than either behaviour, and it keeps the gate's per-action judgement cheap.
     */
    const checkpointMode: CheckpointMode = this.checkpoints
      ? ((await this.persistence.getCheckpointMode()) as CheckpointMode)
      : 'off'
    const checkpointing = this.checkpoints !== undefined && recordsCheckpoints(checkpointMode)
    /**
     * Judge one action against the project the run is actually working in.
     *
     * `productionHost` is deliberately not passed here: the host policy is evaluated at the **SSH
     * layer** (`SshManager.exec`), and a second opinion derived from a different source would be a
     * way for the two to disagree. The classifier supports the input and is tested with it; this
     * call site passes what it can actually see — the tool, its arguments, credentials and
     * destructive command patterns.
     */
    const judge = (
      action: { name: string; arguments: Record<string, unknown> }
    ): ReturnType<typeof classifyImpact> =>
      classifyImpact({
        tool: action.name,
        args: action.arguments ?? {},
        ...(activeProject && activeProject.type !== 'remote' ? { projectRoot: activeProject.path } : {})
      })
    const requestApproval = this.requestApproval
    const requestPlan = this.requestPlan
    const now = (): number => this.now()

    // v2.6.2 T4.2: the identity a trusted plan is bound to. A plan trusted here
    // can only auto-approve while this project/VPS/branch/environment is live, so
    // switching project or moving to production invalidates the trust.
    const planScope: PlanScopeContext = {
      ...(activeProject ? { projectId: activeProject.id } : {}),
      ...(activeProject?.vpsId ? { vpsId: activeProject.vpsId } : {}),
      ...(activeProject?.repository?.branch ? { branch: activeProject.repository.branch } : {}),
      ...(activeProject?.environment ? { environment: activeProject.environment } : {})
    }

    // v2.6.1 Fix 3: rehydrate any trusted plan persisted with the session (e.g.
    // after a restart) so it keeps auto-approving in this chat.
    if (request.sessionId) {
      try {
        const stored = await this.sessionStore.load(request.sessionId)
        const raw = stored?.metadata?.[PLAN_TRUST_METADATA_KEY]
        const restored = this.planTrust.restore(sessionKey, raw)
        if (restored === 'restored') {
          this.emit({ type: 'plan:active', plan: this.planTrust.get(sessionKey)!, at: now() })
        } else if (restored === 'legacy') {
          // Pre-v2.6.2 trust without a scope: never inherited, ask to re-approve.
          this.emit({
            type: 'plan:inactive',
            at: now(),
            reason: 'legacy',
            message: PLAN_REAPPROVE_MESSAGE
          })
        }
      } catch {
        // A missing/corrupt session must never block the run.
      }
    }

    // v2.5.5: the plan the user chose to trust for this session, or null. Expiry
    // is evaluated lazily; when it lapses we tell the chip to hide.
    const activeTrust = (): ApprovedPlan | null => {
      if (this.planTrust.prune(sessionKey)) {
        this.emit({ type: 'plan:inactive', at: now(), reason: 'expired' })
      }
      return this.planTrust.get(sessionKey)
    }

    const baseGate = requestApproval
      ? createApprovalGate({
          mode: approvalMode,
          ...(this.approvedCommands ? { approvedCommands: this.approvedCommands } : {}),
          ...(request.sessionId ? { sessionId: request.sessionId } : {}),
          // Scope remembered approvals to the active project + its VPS (P0-3).
          ...(activeProject
            ? { projectId: activeProject.id, vpsId: activeProject.vpsId ?? '' }
            : {}),
          requestApproval: (action, reason) => requestApproval(runId, action, reason),
          reasonFor: (action) =>
            activeTrust() ? 'outside_plan' : describeApprovalReason(action),
          onSuggestion: (tool, count) => this.emit({ type: 'approval:suggestion', tool, count }),
          ...(checkpointing && this.checkpoints
            ? {
                checkpoint: {
                  mode: checkpointMode,
                  classify: judge,
                  record: async (input: {
                    action: { name: string; arguments: Record<string, unknown> }
                    verdict: ReturnType<typeof classifyImpact>
                  }) => {
                    const checkpoint = {
                      id: `cp-${runId}-${this.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
                      runId,
                      ...(activeProject ? { projectId: activeProject.id } : {}),
                      intent: (request.task ?? '').slice(0, 300),
                      action: describeAction(input.action.name, input.action.arguments),
                      impact: input.verdict.impact,
                      reason: input.verdict.reason,
                      at: this.now()
                    }
                    // A project is required: the log is per project, and an unscoped record would be
                    // unfindable. Recording is best-effort — a checkpoint must never fail a run.
                    if (!activeProject) return undefined
                    await this.checkpoints!.append(checkpoint).catch(() => undefined)
                    return checkpoint.id
                  },
                  resolve: async (id: string, decision: 'approved' | 'rejected' | 'timeout') => {
                    if (!activeProject) return
                    await this.checkpoints!
                      .append({
                        id: `${id}-result`,
                        runId,
                        projectId: activeProject.id,
                        intent: 'resolution',
                        action: id,
                        impact: 'routine',
                        reason: decision,
                        at: this.now(),
                        resolved: { decision, at: this.now() }
                      })
                      .catch(() => undefined)
                  }
                }
              }
            : {})
        })
      : undefined

    // A trusted plan auto-approves its own steps — never a deny-listed command,
    // and only within the exact scope it was granted for (v2.6.2 T4.2).
    const approvalGate = baseGate
      ? async (action: AgentAction): Promise<boolean> => {
          if (shouldAutoApprove(activeTrust(), action, now(), planScope)) {
            /*
             * v3.1: a trusted plan auto-approves its own steps *before* the gate is consulted, so a
             * checkpoint that lived only inside the gate would be skipped for exactly the runs that
             * mutate the most. A trusted plan is consent to the plan, not to the irreversible:
             * anything that cannot be undone still goes through the gate and therefore to the user.
             */
            const verdict = checkpointing ? judge(action) : undefined
            if (!(checkpointMode === 'confirm' && verdict?.impact === 'irreversible')) return true
          }
          return baseGate(action)
        }
      : undefined

    const planGate = requestPlan
      ? async (plan: Plan, warnings: PlanWarning[]): Promise<PlanDecision> => {
          const decision = await requestPlan(runId, plan, warnings)
          const approved = createApprovedPlan(plan, sessionKey, decision, now(), {
            scope: planScope
          })
          if (approved) {
            this.planTrust.set(sessionKey, approved)
            this.emit({ type: 'plan:active', plan: approved, at: now() })
          } else if (this.planTrust.clear(sessionKey)) {
            this.emit({ type: 'plan:inactive', at: now(), reason: 'cleared' })
          }
          return decision
        }
      : undefined

    const preflightGate = await this.buildPreflightGate()

    // v2.6.2 T3.3: every decision this run emits is also appended to the active
    // project's tamper-evident audit trail (redacted, never blocking the run).
    const audit = input.audit
    const onDecision =
      audit && activeProject
        ? (decision: TraceDecision) => {
            void audit
              .append(
                auditLineFromDecision(decision, {
                  projectId: activeProject.id,
                  ...(activeProject.vpsId ? { vpsId: activeProject.vpsId } : {})
                })
              )
              .catch(() => undefined)
          }
        : undefined

    // v2.6.3 T3.2: turn a preflight block into an interactive, audited decision.
    // Only wired when a gate exists (remote projects); every answer is recorded.
    const preflightOverride =
      preflightGate && this.requestPreflight && audit && activeProject
        ? async (
            action: AgentAction,
            result: PreflightResult,
            tier: PreflightTier,
            context: { attempt: number }
          ): Promise<PreflightChoice> => {
            // The orchestrator only calls this for block/critical, but narrow
            // explicitly so the audited tier and the broker agree by type.
            if (tier !== 'block' && tier !== 'critical') return 'cancel'
            const choice = await this.requestPreflight!(runId, action, result, tier, context)
            void audit
              .append(
                auditLineFromPreflightOverride({
                  projectId: activeProject.id,
                  ...(activeProject.vpsId ? { vpsId: activeProject.vpsId } : {}),
                  runId,
                  tool: action.name,
                  tier,
                  reason: extractPreflightReason(result.checks),
                  choice,
                  ...(goalContext.goal ? { goalId: goalContext.goal.id } : {})
                })
              )
              .catch(() => undefined)
            return choice
          }
        : undefined
    return {
      approvalMode,
      planMode,
      ...(approvalGate ? { approvalGate } : {}),
      ...(planGate ? { planGate } : {}),
      ...(preflightGate ? { preflightGate } : {}),
      ...(preflightOverride ? { preflightOverride } : {}),
      ...(onDecision ? { onDecision } : {})
    }
  }

  /**
   * v2.4 A.2 — build a preflight gate for the active remote project, if any. The
   * workspace state is read over the existing SSH exec before sensitive actions.
   */
  private async buildPreflightGate(): Promise<
    ((action: AgentAction) => Promise<PreflightResult | undefined>) | undefined
  > {
    if (!this.vps) return undefined
    const project = this.persistence.getActiveProject()
    if (!project || project.type !== 'remote' || !project.vpsId) return undefined
    const serverId = project.vpsId
    if (!this.vps.connectedServers().includes(serverId)) return undefined
    const path = project.path
    const vps = this.vps
    return (action) => {
      const kind = preflightActionFor(action.name, action.arguments)
      if (!kind) return Promise.resolve(undefined)
      return preflight((command) => vps.exec(serverId, command), { path, isGitRepo: true }, kind)
    }
  }
}