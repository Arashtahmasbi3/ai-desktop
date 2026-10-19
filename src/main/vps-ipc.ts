import { ipcMain } from 'electron'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { HealthCheckConfig, SshConfigHost, VpsServerInput } from '@shared/vps'
import type { RemoteWorkspaceInfo } from '@shared/workspace-info'
import type { SystemHealth } from '@shared/system-health'
import { parseSshConfig } from '@core/remote/ssh-config'
import { detectWorkspace } from '@core/remote/workspace-detect'
import { parseRemoteGitStatus, type RemoteGitStatus } from '@core/remote/git-status'
import { getSystemHealth } from '@core/remote/system-health'
import { buildGitSetupCommands, type GitSetupOptions } from '@core/remote/git-setup'
import { assertInstallAllowed, buildInstallCommands, getInstallRecipe } from '@core/agent/install-recipes'
import { runRemoteCommands } from '@core/remote/run-commands'
import { observeServerReachability } from './reachability'
import type { AppServices } from './app-services'
import { shellQuote } from '@shared/shell-quote'

/** POSIX single-quote a value so it can be safely embedded in a shell command. */

/** `find` a project folder by (partial) name under `/`, capped depth + results. */
async function searchRemoteProject(
  services: AppServices,
  serverId: string,
  name: string
): Promise<string[]> {
  const query = name.trim()
  if (!query) return []
  const pattern = shellQuote(`*${query}*`)
  const command = `find / -maxdepth 4 -type d -iname ${pattern} 2>/dev/null | head -n 100`
  const result = await services.vps.exec(serverId, command)
  if (result.blocked) throw new Error(result.reason ?? 'Blocked by policy')
  if (result.rateLimited) throw new Error(result.reason ?? 'Rate limited')
  return result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

/** List directories (2 levels) under a remote path. */
async function listRemoteDirs(
  services: AppServices,
  serverId: string,
  path: string
): Promise<string[]> {
  const target = path.trim() || '/'
  const command = `find ${shellQuote(target)} -maxdepth 2 -type d 2>/dev/null | head -n 200`
  const result = await services.vps.exec(serverId, command)
  if (result.blocked) throw new Error(result.reason ?? 'Blocked by policy')
  return result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

/** Short `git status` for a remote working tree. */
async function remoteGitStatus(
  services: AppServices,
  serverId: string,
  path: string
): Promise<string> {
  const command = `cd ${shellQuote(path)} && git status --porcelain=v1 -b 2>&1 | head -n 200`
  const result = await services.vps.exec(serverId, command)
  if (result.blocked) throw new Error(result.reason ?? 'Blocked by policy')
  return `${result.stdout}${result.stderr}`.trim()
}

// --- v2.3.3: git-aware + self-diagnosis helpers -----------------------------

/** A.1: structured git detection for a remote project folder. */
async function remoteWorkspaceInfo(
  services: AppServices,
  serverId: string,
  path: string
): Promise<RemoteWorkspaceInfo> {
  return detectWorkspace(async (command) => {
    const result = await services.vps.exec(serverId, command)
    if (result.blocked) throw new Error(result.reason ?? 'Blocked by policy')
    return { ok: result.ok, stdout: result.stdout, stderr: result.stderr }
  }, path)
}

/** B.2: structured git status for the sidebar panel. */
async function remoteGitStatusParsed(
  services: AppServices,
  serverId: string,
  path: string
): Promise<RemoteGitStatus> {
  const command = `cd ${shellQuote(path)} && git status --porcelain=v1 --branch 2>/dev/null`
  const result = await services.vps.exec(serverId, command)
  if (result.blocked) throw new Error(result.reason ?? 'Blocked by policy')
  return parseRemoteGitStatus(result.stdout)
}

/** C.1: probe the host for installed tooling and disk/memory. */
async function remoteSystemHealth(services: AppServices, serverId: string): Promise<SystemHealth> {
  return getSystemHealth(async (command) => {
    const result = await services.vps.exec(serverId, command)
    return { ok: result.ok, stdout: result.stdout }
  })
}

/** B.1: run an approved git-setup plan, stopping at the first failure. */
async function applyRemoteGitSetup(
  services: AppServices,
  serverId: string,
  path: string,
  options: GitSetupOptions
): Promise<{ ran: string[]; output: string }> {
  const commands = buildGitSetupCommands(path, options)
  return runRemoteCommands((command) => services.vps.exec(serverId, command), commands)
}

/**
 * C.3: run an install recipe. Every install needs explicit approval, and a
 * sudo recipe additionally needs `elevated` so a single click can't gain root.
 */
async function runInstallRecipe(
  services: AppServices,
  serverId: string,
  tool: string,
  approved: boolean,
  elevated: boolean
): Promise<{ ran: string[]; output: string }> {
  const recipe = getInstallRecipe(tool)
  assertInstallAllowed(recipe, approved, elevated)
  const outcome = await runRemoteCommands(
    (command) => services.vps.exec(serverId, command),
    buildInstallCommands(recipe)
  )
  const verify = await services.vps.exec(serverId, recipe.verify)
  const verifyText = `${verify.stdout}${verify.stderr}`.trim()
  return { ...outcome, output: [outcome.output, verifyText].filter(Boolean).join('\n') }
}

/**
 * IPC surface for the VPS feature. Kept out of `ipc.ts` so the large SSH
 * feature registers its own channels and cleanup in one place.
 */
export function registerVpsIpc(services: AppServices): () => void {
  const handlers: Array<[string, (...args: never[]) => unknown]> = [
    ['vps:list', () => services.vpsServers.list()],
    ['vps:save', (input: VpsServerInput) => services.vpsServers.save(input)],
    ['vps:remove', (id: string) => services.vpsServers.remove(id)],
    ['vps:status', () => services.vps.getState()],
    // v2.6.5: refresh the idle stamp for a host an open project depends on, so the
    // 30-minute watchdog does not reap it and force a reconnect.
    [
      'vps:keepAlive',
      (id: string) => {
        services.vps.markActive(id)
        return services.vps.getState()
      }
    ],
    ['vps:connected', () => services.vps.connectedServers()],
    /*
     * v4.1: answer "is it reachable from here?" without a model call and without SSH credentials. A TCP
     * connect from this computer is the honest version of what the agent used to do with /dev/tcp.
     *
     * X4 (v4.3): "from here" is only one path. The answer now carries `paths` — the same question asked
     * from a connected source server and from the target itself (when a session to it exists) — because
     * a port filtered from a server said nothing about the user's own computer, and that was the path
     * that could have decided the whole diagnosis. A path nobody could test is reported as `unknown`.
     */
    [
      'vps:testConnection',
      async (id: string) => {
        const server = (await services.vpsServers.list()).find((entry) => entry.id === id)
        if (server === undefined) {
          return {
            ok: false,
            host: '',
            port: 0,
            outcome: 'invalid' as const,
            message: 'unknown server',
            from: 'this-machine' as const
          }
        }
        const observed = await observeServerReachability(services.vps, {
          id: server.id,
          name: server.name,
          host: server.host,
          port: server.port
        })
        return { ...observed.local, paths: observed.report }
      }
    ],
    ['vps:connect', (id: string) => services.vps.connect(id)],
    ['vps:disconnect', (id: string) => services.vps.disconnect(id)],
    ['vps:approveFingerprint', (id: string) => services.vps.approveFingerprint(id)],
    ['vps:exec', (id: string, command: string) => services.vps.exec(id, command)],
    ['vps:audit', () => services.vps.auditEntries()],
    [
      'vps:healthCheck',
      (id: string, config: HealthCheckConfig) => services.vps.healthCheck(id, config)
    ],
    [
      'vps:importSshConfig',
      async (): Promise<SshConfigHost[]> => {
        try {
          const text = await readFile(join(homedir(), '.ssh', 'config'), 'utf8')
          return parseSshConfig(text)
        } catch {
          // No config file (or unreadable) simply means nothing to import.
          return []
        }
      }
    ],
    ['vps:searchProject', (id: string, name: string) => searchRemoteProject(services, id, name)],
    ['vps:listDirs', (id: string, path: string) => listRemoteDirs(services, id, path)],
    ['vps:gitStatus', (id: string, path: string) => remoteGitStatus(services, id, path)],
    // --- v2.3.3 ---
    [
      'vps:workspaceInfo',
      (id: string, path: string) => remoteWorkspaceInfo(services, id, path)
    ],
    [
      'vps:gitStatusParsed',
      (id: string, path: string) => remoteGitStatusParsed(services, id, path)
    ],
    ['vps:systemHealth', (id: string) => remoteSystemHealth(services, id)],
    [
      'vps:gitSetup',
      (id: string, path: string, options: GitSetupOptions) =>
        applyRemoteGitSetup(services, id, path, options)
    ],
    [
      'vps:installTool',
      (id: string, tool: string, approved: boolean, elevated: boolean) =>
        runInstallRecipe(services, id, tool, approved, elevated)
    ],
    [
      'vps:terminalOpen',
      (id: string, cols: number | undefined, rows: number | undefined) =>
        services.vps.openTerminal(id, cols ?? 80, rows ?? 24)
    ],
    [
      'vps:terminalWrite',
      (id: string, data: string) => {
        services.vps.writeTerminal(id, data)
      }
    ],
    [
      'vps:terminalResize',
      (id: string, cols: number, rows: number) => {
        services.vps.resizeTerminal(id, cols, rows)
      }
    ],
    [
      'vps:terminalClose',
      (id: string, sessionId?: string) => {
        services.vps.closeTerminal(id, sessionId)
      }
    ],
    ['vps:files:list', (id: string, path: string) => services.vps.listFiles(id, path)],
    ['vps:files:read', (id: string, path: string) => services.vps.readFile(id, path)],
    [
      'vps:files:write',
      (id: string, path: string, content: string) => services.vps.writeFile(id, path, content)
    ],
    [
      'vps:files:restoreBackup',
      (id: string, backupPath: string) => services.vps.restoreBackup(id, backupPath)
    ]
  ]

  for (const [channel, handler] of handlers) {
    ipcMain.handle(channel, (_event, ...args) => handler(...(args as never[])))
  }

  return () => {
    for (const [channel] of handlers) ipcMain.removeHandler(channel)
  }
}
