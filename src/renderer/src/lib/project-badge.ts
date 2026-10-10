/**
 * Sidebar project badge derivation (v2.3.2, C.2.1).
 *
 * Pure, dependency-free helpers so the Sidebar row and its tests agree on how a
 * project is summarised: environment dot, local/remote type, and whether the
 * project's policy override diverges from its host's policy.
 */
import type { HostApprovalRequirement, HostPolicy } from '@shared/vps'
import type { ProjectRecord } from '@shared/ui'

export type ProjectEnvironment = 'development' | 'staging' | 'production'

const ENV_DOT: Record<ProjectEnvironment, string> = {
  development: '🟢',
  staging: '🟡',
  production: '🔴'
}

const ENV_LABEL_KEY: Record<ProjectEnvironment, string> = {
  development: 'settings.environmentDevelopment',
  staging: 'settings.environmentStaging',
  production: 'settings.environmentProduction'
}

/** Normalise an unset/unknown environment to `development` (the schema default). */
export function environmentOf(project: Pick<ProjectRecord, 'environment'>): ProjectEnvironment {
  return project.environment === 'staging' || project.environment === 'production'
    ? project.environment
    : 'development'
}

export function environmentDot(project: Pick<ProjectRecord, 'environment'>): string {
  return ENV_DOT[environmentOf(project)]
}

export function environmentLabelKey(project: Pick<ProjectRecord, 'environment'>): string {
  return ENV_LABEL_KEY[environmentOf(project)]
}

/** 🖥️ for a local folder, ☁️ for a folder on a remote host. */
export function projectTypeBadge(type: ProjectRecord['type']): string {
  return type === 'remote' ? '☁️' : '🖥️'
}

const APPROVAL_RANK: Record<HostApprovalRequirement, number> = {
  never: 0,
  destructive: 1,
  always: 2
}

/**
 * Whether a project's policy override diverges from its host policy in a way
 * that changes (or weakens) the guardrails: a different mode, or a looser
 * approval requirement than the host mandates.
 */
export function hasPolicyMismatch(
  projectPolicy: HostPolicy | undefined,
  hostPolicy: HostPolicy | undefined
): boolean {
  if (!projectPolicy || !hostPolicy) return false
  if (projectPolicy.mode !== hostPolicy.mode) return true
  return APPROVAL_RANK[projectPolicy.requireApproval] < APPROVAL_RANK[hostPolicy.requireApproval]
}
