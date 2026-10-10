/**
 * Per-project metadata (v2.3.2, C.1).
 *
 * Pure helpers shared by the persisted record (`@core/agent/persistence`), the
 * IPC view (`@shared/ui`) and the renderer, so main and UI agree on what a
 * project identity is. Every field is additive and optional: records written by
 * older builds stay valid and are backfilled in place, never rewritten
 * destructively.
 */

import type { HealthCheckConfig, HostPolicy } from './vps'

export type ProjectEnvironment = 'development' | 'staging' | 'production'

export const PROJECT_ENVIRONMENTS: readonly ProjectEnvironment[] = [
  'development',
  'staging',
  'production'
]

export const DEFAULT_PROJECT_ENVIRONMENT: ProjectEnvironment = 'development'

/** Git remote a project tracks. */
export interface ProjectRepositoryRef {
  url: string
  branch: string
}

/** Extra, purely-additive project metadata introduced in schema v3. */
export interface ProjectMetadata {
  /** Last metadata change; defaults to `createdAt` for migrated records. */
  updatedAt?: number
  environment?: ProjectEnvironment
  /** Where the project's command audit trail is written (local projects only). */
  auditLogPath?: string
  repository?: ProjectRepositoryRef
  dockerComposeProject?: string
  ports?: number[]
  domains?: string[]
  /** Login user on the remote host (remote projects). */
  linuxUser?: string
  /** keytar entry name for the SSH key; never key material. */
  sshKeyRef?: string
  /** Public key fingerprint (e.g. `SHA256:...`); never key material. */
  sshKeyFingerprint?: string
  /** Overrides the VPS host policy for this project. */
  policy?: HostPolicy
  healthCheck?: HealthCheckConfig
}

export function isProjectEnvironment(value: unknown): value is ProjectEnvironment {
  return typeof value === 'string' && (PROJECT_ENVIRONMENTS as readonly string[]).includes(value)
}

/** A validated patch of project metadata sent over IPC (Settings → Projects). */
export type ProjectMetadataPatch = Partial<ProjectMetadata>

/** Audit file for a project root: `<root>/.ai-desktop/audit.log` (POSIX-ish). */
export function auditLogPathFor(root: string): string {
  const normalized = root.trim().replace(/\\/g, '/').replace(/\/+$/, '')
  return `${normalized}/.ai-desktop/audit.log`
}

/** Derived view of the folder this project points at. */
export interface ProjectPathInput {
  path: string
  type?: 'local' | 'remote'
  vpsId?: string
}

/** Canonical local folder, or undefined for a remote project. */
export function getLocalPath(project: ProjectPathInput): string | undefined {
  return project.type === 'remote' ? undefined : project.path || undefined
}

/** Canonical remote folder, or undefined for a local project. */
export function getRemotePath(project: ProjectPathInput): string | undefined {
  return project.type === 'remote' ? project.path || undefined : undefined
}

/** VPS a remote project lives on, or undefined for a local project. */
export function getRemoteVpsId(project: ProjectPathInput): string | undefined {
  return project.type === 'remote' ? project.vpsId : undefined
}

/** Minimal shape `applyProjectMetadataDefaults` needs. */
export interface ProjectMetadataInput extends ProjectPathInput, ProjectMetadata {
  createdAt?: number
}

/**
 * Backfill v3 metadata defaults. Idempotent (an existing `updatedAt` is never
 * overwritten) and non-destructive (nothing already set is dropped).
 */
export function applyProjectMetadataDefaults<P extends ProjectMetadataInput>(
  project: P,
  now: number
): P {
  const next: P = { ...project }
  if (typeof next.updatedAt !== 'number') {
    next.updatedAt = typeof next.createdAt === 'number' ? next.createdAt : now
  }
  if (!isProjectEnvironment(next.environment)) {
    next.environment = DEFAULT_PROJECT_ENVIRONMENT
  }
  if (
    next.type !== 'remote' &&
    (typeof next.auditLogPath !== 'string' || next.auditLogPath === '')
  ) {
    next.auditLogPath = auditLogPathFor(next.path)
  }
  return next
}
