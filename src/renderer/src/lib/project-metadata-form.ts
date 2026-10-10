/**
 * Settings → Projects: form ⇄ metadata mapping + validation (v2.3.2, C.1).
 *
 * Pure and dependency-free so it can be unit-tested without a DOM. The form is
 * a flat bag of strings (what an `<input>` holds); `validateProjectMetadataForm`
 * turns it into a `ProjectMetadataPatch` or a map of field → error key.
 */

import {
  PROJECT_ENVIRONMENTS,
  isProjectEnvironment,
  type ProjectMetadata,
  type ProjectMetadataPatch
} from '@shared/project-metadata'
import type { HostApprovalRequirement, HostPolicy, HostPolicyMode } from '@shared/vps'

export const POLICY_MODES: readonly HostPolicyMode[] = ['read-only', 'staging', 'production']
export const APPROVAL_REQUIREMENTS: readonly HostApprovalRequirement[] = [
  'never',
  'destructive',
  'always'
]

export interface ProjectMetadataForm {
  environment: string
  repositoryUrl: string
  repositoryBranch: string
  ports: string
  domains: string
  dockerComposeProject: string
  linuxUser: string
  sshKeyRef: string
  policyMode: string
  policyRequireApproval: string
  policyAllowCommands: string
  policyDenyCommands: string
  healthProcessName: string
  healthPort: string
  healthEndpoint: string
  auditLogPath: string
}

/** Split a comma/newline separated field into trimmed, non-empty tokens. */
function tokens(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter((item) => item !== '')
}

function joinList(value?: string[] | number[]): string {
  return value && value.length > 0 ? value.join(', ') : ''
}

/** A git URL: scp-like (`git@host:path`), `ssh://`, `http(s)://` or `git://`. */
export function isValidRepositoryUrl(url: string): boolean {
  const value = url.trim()
  if (value === '') return false
  return (
    /^[\w.-]+@[\w.-]+:[\w./~-]+$/.test(value) ||
    /^(ssh|https?|git):\/\/[^\s]+$/.test(value)
  )
}

/** A pragmatic hostname / domain check (labels, dots, optional TLD). */
export function isValidDomain(domain: string): boolean {
  const value = domain.trim()
  if (value === '' || value.length > 253) return false
  return /^(?=.{1,253}$)([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/.test(
    value
  )
}

function parsePortList(value: string): { ports?: number[]; bad?: string } {
  const list = tokens(value)
  const ports: number[] = []
  for (const item of list) {
    if (!/^\d+$/.test(item)) return { bad: item }
    const port = Number(item)
    if (port < 1 || port > 65535) return { bad: item }
    ports.push(port)
  }
  return { ports }
}

function parsePort(value: string): { port?: number; bad?: boolean } {
  const trimmed = value.trim()
  if (trimmed === '') return {}
  if (!/^\d+$/.test(trimmed)) return { bad: true }
  const port = Number(trimmed)
  if (port < 1 || port > 65535) return { bad: true }
  return { port }
}

/** Build the editable form from a project record. */
export function formFromProject(project: ProjectMetadata): ProjectMetadataForm {
  return {
    environment: project.environment ?? 'development',
    repositoryUrl: project.repository?.url ?? '',
    repositoryBranch: project.repository?.branch ?? '',
    ports: joinList(project.ports),
    domains: joinList(project.domains),
    dockerComposeProject: project.dockerComposeProject ?? '',
    linuxUser: project.linuxUser ?? '',
    sshKeyRef: project.sshKeyRef ?? '',
    policyMode: project.policy?.mode ?? '',
    policyRequireApproval: project.policy?.requireApproval ?? '',
    policyAllowCommands: joinList(project.policy?.allowCommands),
    policyDenyCommands: joinList(project.policy?.denyCommands),
    healthProcessName: project.healthCheck?.processName ?? '',
    healthPort: project.healthCheck?.port ? String(project.healthCheck.port) : '',
    healthEndpoint: project.healthCheck?.healthEndpoint ?? '',
    auditLogPath: project.auditLogPath ?? ''
  }
}

export interface ProjectMetadataValidation {
  patch: ProjectMetadataPatch
  /** field name → i18n error key suffix (e.g. `invalidPorts`). */
  errors: Record<string, string>
}

/**
 * Validate the form and produce a metadata patch. `vpsId` seeds a policy
 * override when one is created (remote projects).
 */
export function validateProjectMetadataForm(
  form: ProjectMetadataForm,
  vpsId?: string
): ProjectMetadataValidation {
  const errors: Record<string, string> = {}
  const patch: ProjectMetadataPatch = {}

  if (!isProjectEnvironment(form.environment)) {
    errors.environment = 'invalidEnvironment'
  } else {
    patch.environment = form.environment
  }

  const url = form.repositoryUrl.trim()
  const branch = form.repositoryBranch.trim()
  if (url !== '' || branch !== '') {
    if (url === '' || !isValidRepositoryUrl(url)) errors.repositoryUrl = 'invalidUrl'
    if (branch === '') errors.repositoryBranch = 'required'
    if (!errors.repositoryUrl && !errors.repositoryBranch) {
      patch.repository = { url, branch }
    }
  }

  const ports = parsePortList(form.ports)
  if (ports.bad !== undefined) errors.ports = 'invalidPorts'
  else if (ports.ports && ports.ports.length > 0) patch.ports = ports.ports

  const domains = tokens(form.domains)
  const badDomain = domains.find((domain) => !isValidDomain(domain))
  if (badDomain) errors.domains = 'invalidDomains'
  else if (domains.length > 0) patch.domains = domains

  const dockerComposeProject = form.dockerComposeProject.trim()
  if (dockerComposeProject !== '') patch.dockerComposeProject = dockerComposeProject

  const linuxUser = form.linuxUser.trim()
  if (linuxUser !== '') patch.linuxUser = linuxUser

  const sshKeyRef = form.sshKeyRef.trim()
  if (sshKeyRef !== '') {
    // Guard rail: never accept pasted key material, only a reference.
    if (sshKeyRef.includes('PRIVATE KEY')) errors.sshKeyRef = 'notKeyMaterial'
    else patch.sshKeyRef = sshKeyRef
  }

  const policyMode = form.policyMode.trim()
  if (policyMode !== '') {
    if (!(POLICY_MODES as readonly string[]).includes(policyMode)) {
      errors.policyMode = 'invalidPolicy'
    } else {
      const requireApproval = form.policyRequireApproval.trim() as HostApprovalRequirement
      const policy: HostPolicy = {
        vpsId: vpsId ?? '',
        mode: policyMode as HostPolicyMode,
        allowCommands: tokens(form.policyAllowCommands),
        denyCommands: tokens(form.policyDenyCommands),
        requireApproval: (APPROVAL_REQUIREMENTS as readonly string[]).includes(requireApproval)
          ? requireApproval
          : 'destructive',
        allowedPaths: []
      }
      patch.policy = policy
    }
  }

  const healthPort = parsePort(form.healthPort)
  if (healthPort.bad) errors.healthPort = 'invalidPort'
  const processName = form.healthProcessName.trim()
  const endpoint = form.healthEndpoint.trim()
  if (processName !== '' || healthPort.port !== undefined || endpoint !== '') {
    patch.healthCheck = {
      ...(processName ? { processName } : {}),
      ...(healthPort.port !== undefined ? { port: healthPort.port } : {}),
      ...(endpoint ? { healthEndpoint: endpoint } : {})
    }
  }

  return { patch, errors }
}

export function hasErrors(errors: Record<string, string>): boolean {
  return Object.keys(errors).length > 0
}

export { PROJECT_ENVIRONMENTS }
