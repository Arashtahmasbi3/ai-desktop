/**
 * v2.4.1 wiring: exposes the modules built in v2.4 as agent tools.
 *
 * Kept out of `agent-service.ts` so the tool list, hints and toggle groups are a
 * single testable unit. The host is injected (real SSH manager in the app, a fake
 * in tests).
 */

import type { ToolDefinition } from '@shared/types'
import type { VpsExecResult } from '@shared/vps'
import type { AuditEntry } from '@core/agent/audit-log'
import type { ToolRoute } from '@core/tools/composite-executor'
import { TOOL_TOGGLE_GROUPS, enabledToolNames } from '@shared/tool-toggles'
import { dbMigrateTool, DbMigrateToolExecutor, type DbMigrateDeps } from '@core/tools/db-migrate-tool'
import {
  dockerMigrateTool,
  DockerMigrateToolExecutor,
  type DockerMigrateDeps
} from '@core/tools/docker-migrate-tool'
import { buildFileTransferCommand } from '@core/tools/migrate-project-tool'
import { scaffoldTool, ScaffoldProjectToolExecutor } from '@core/tools/scaffold-tool'
import { projectUserTools, ProjectUserToolExecutor } from '@core/tools/project-user-tool'
import { worktreeTools, WorktreeToolExecutor } from '@core/tools/worktree-tool'

/** A saved server's connection details, as returned by the SSH manager. */
export interface V24ServerConnection {
  host: string
  port: number
  username: string
}

/** The slice of the SSH manager the v2.4.1 tools need. */
export interface V24ToolHost {
  connectedServers(): string[]
  exec(serverId: string, command: string): Promise<VpsExecResult>
  resolveServer?(id: string): Promise<V24ServerConnection | undefined>
  recordAudit?(entry: Omit<AuditEntry, 'at'>): Promise<unknown>
  /** Ask the user to approve a sudo command; defaults to allow (approval gate already ran). */
  requestSudoApproval?(serverId: string, command: string): Promise<boolean>
}

/** Settings toggle groups (B.1). Kept as a re-export for existing tests. */
export const V24_TOOL_GROUPS = TOOL_TOGGLE_GROUPS

/** Resolve which tool names are enabled. `undefined` means "all enabled". */
export function enabledV24ToolNames(enabledTools?: string[]): Set<string> {
  return enabledToolNames(enabledTools)
}

export interface V24Wiring {
  extraTools: ToolDefinition[]
  routes: ToolRoute[]
  hint: string
}

const HINTS: Record<string, string> = {
  migrate_database:
    'Use migrate_database for cross-VPS database migration. Supported: postgres, mysql, mongodb, sqlite. Always dry-run first.',
  migrate_docker:
    'Use migrate_docker for Docker image transfer. Supports: registry push/pull OR save/load.',
  scaffold_project:
    'Use scaffold_project to create new projects. Templates: node-ts, react-vite, python, static. Always asks: goal, tech, environment first.',
  project_user:
    'Use project_user_create / project_user_remove to manage a dedicated Linux user per project (requires sudo approval).',
  worktree_manager:
    'Use worktree_create / worktree_list / worktree_remove to work on several branches of a project in parallel.'
}

/**
 * Build the extra tools, routes and system hints for the v2.4.1 modules. Returns
 * empty arrays/string when the host cannot resolve servers (db/docker) or nothing
 * is enabled.
 */
export function planV24Tools(host: V24ToolHost, enabledTools?: string[]): V24Wiring {
  const enabled = enabledV24ToolNames(enabledTools)
  const extraTools: ToolDefinition[] = []
  const routes: ToolRoute[] = []
  const hints: string[] = []

  const audit = host.recordAudit
    ? (entry: { ok: boolean; detail: string }) =>
        host.recordAudit!({ ok: entry.ok, type: 'exec', detail: entry.detail }).then(() => undefined)
    : undefined
  const exec = (serverId: string, command: string): Promise<VpsExecResult> => host.exec(serverId, command)

  // --- project_user ---
  const userTools = projectUserTools.filter((tool) => enabled.has(tool.name))
  if (userTools.length > 0) {
    const deps = {
      exec,
      // v2.6.5: the sudo gate is mandatory in the manager, so a host without the
      // hook must deny outright instead of letting `sudo useradd` run unapproved.
      approveSudo: host.requestSudoApproval ?? (async () => false),
      ...(audit ? { audit } : {})
    }
    extraTools.push(...userTools)
    routes.push({ names: new Set(userTools.map((tool) => tool.name)), executor: new ProjectUserToolExecutor(deps) })
    hints.push(HINTS.project_user!)
  }

  // --- worktree_manager ---
  const trees = worktreeTools.filter((tool) => enabled.has(tool.name))
  if (trees.length > 0) {
    extraTools.push(...trees)
    routes.push({
      names: new Set(trees.map((tool) => tool.name)),
      executor: new WorktreeToolExecutor({ exec })
    })
    hints.push(HINTS.worktree_manager!)
  }

  // --- scaffold_project ---
  if (enabled.has(scaffoldTool.name)) {
    extraTools.push(scaffoldTool)
    routes.push({
      names: new Set([scaffoldTool.name]),
      executor: new ScaffoldProjectToolExecutor({ exec, ...(audit ? { audit } : {}) })
    })
    hints.push(HINTS.scaffold_project!)
  }

  // --- migrate_database / migrate_docker need cross-host resolution ---
  if (host.resolveServer) {
    const transfer = async (
      fromServerId: string,
      fromPath: string,
      toServerId: string,
      toPath: string
    ): Promise<{ ok: boolean; message?: string }> => {
      const target = await host.resolveServer!(toServerId)
      if (!target) return { ok: false, message: `Unknown target server "${toServerId}"` }
      const result = await exec(fromServerId, buildFileTransferCommand(fromPath, target, toPath))
      return result.ok ? { ok: true } : { ok: false, message: result.stderr || 'transfer failed' }
    }

    if (enabled.has(dbMigrateTool.name)) {
      const deps: DbMigrateDeps = { exec, transfer }
      if (audit) deps.audit = audit
      extraTools.push(dbMigrateTool)
      routes.push({ names: new Set([dbMigrateTool.name]), executor: new DbMigrateToolExecutor(deps) })
      hints.push(HINTS.migrate_database!)
    }

    if (enabled.has(dockerMigrateTool.name)) {
      const deps: DockerMigrateDeps = { exec, transfer }
      if (audit) deps.audit = audit
      extraTools.push(dockerMigrateTool)
      routes.push({ names: new Set([dockerMigrateTool.name]), executor: new DockerMigrateToolExecutor(deps) })
      hints.push(HINTS.migrate_docker!)
    }
  }

  return { extraTools, routes, hint: hints.join(' ') }
}
