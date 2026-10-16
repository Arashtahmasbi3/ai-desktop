import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import type { CustomProviderInput, ProviderId } from '@shared/types'
import type { ApprovalMode, ApprovalOutcome } from '@shared/approval'
import type { InvestigateScope, SessionProfile } from '@shared/profile'
import type { PlanDecision } from '@shared/plan'
import type { PreflightChoice } from '@shared/preflight'
import type { ProjectMetadataPatch } from '@shared/project-metadata'
import type { GitCommitInput } from '@shared/github'
import type { AgentRunRequest, WorkerJobRequest } from '@shared/ui'
import type { GoalUpdate, NewGoalInput } from '@shared/goal'

import type { AppServices } from './app-services'
import { registerVpsIpc } from './vps-ipc'
import { runLocalCommand } from './local-shell'
import { searchProject } from './project-search'
import { canRememberTool, createRememberedApproval } from '@core/agent/remember-policy'
import { toAttachmentRefView } from '@shared/attachments'

/**
 * Registers every IPC channel the renderer is allowed to call. Handlers only
 * expose the curated service methods — the renderer never gets direct access to
 * Node, the filesystem or child processes.
 */
export function registerIpc(
  services: AppServices,
  getWindow: () => BrowserWindow | null,
  openWindow: () => void
): () => void {
  // Broadcast so every window (multi-window support, D.5) sees shared state.
  const send = (channel: string, payload: unknown): void => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(channel, payload)
    }
  }
  services.setSender(send)

  const changed = async (): Promise<unknown> => {
    const view = await services.settingsView()
    send('settings:changed', view)
    return view
  }
  const filesChanged = (): void => {
    const root = services.files.getRoot()
    if (root) send('files:changed', { root })
  }
  /** The project a goal operation applies to, defaulting to the active one. */
  const goalProject = (projectId?: string): string => {
    const id = projectId ?? services.persistence.getActiveProject()?.id
    if (!id) throw new Error('No active project. Add or select a project first.')
    return id
  }

  const handlers: Array<[string, (...args: never[]) => unknown]> = [
    ['app:ping', () => 'pong'],

    ['chats:list', () => services.chats.list()],
    ['chats:load', (id: string) => services.chats.load(id)],
    [
      'chats:save',
      (input: Parameters<typeof services.chats.save>[0]) => services.chats.save(input)
    ],
    ['chats:rename', (id: string, title: string) => services.chats.rename(id, title)],
    ['chats:linkProject', (id: string, workspaceId: string) => services.chats.linkProject(id, workspaceId)],
    ['chats:remove', (id: string) => services.chats.remove(id)],

    ['settings:get', () => services.settingsView()],
    [
      'settings:setApiKey',
      async (provider: ProviderId, apiKey: string) => {
        await services.persistence.setApiKey(provider, apiKey)
        return changed()
      }
    ],
    [
      'settings:removeApiKey',
      async (provider: ProviderId) => {
        await services.persistence.removeApiKey(provider)
        return changed()
      }
    ],
    [
      'settings:setModel',
      async (provider: ProviderId, model: string) => {
        await services.persistence.setProviderModel(provider, model)
        return changed()
      }
    ],
    [
      'settings:setActiveProvider',
      async (provider: ProviderId) => {
        await services.persistence.setActiveProvider(provider)
        return changed()
      }
    ],
    [
      'settings:setApprovalMode',
      async (mode: ApprovalMode) => {
        if (mode === 'full') {
          // v2.6.2 (P0-5): `full` is a scoped, TTL-bounded elevation grant owned
          // by main — never merely a persisted preference the renderer can set.
          await services.grantElevation()
        } else {
          // v2.6.1 compat: `ask`/`auto-write` stay Develop profile; the persisted
          // approval preference still drives the effective mode.
          await services.persistence.setApprovalMode(mode)
          await services.sessionProfile.setProfile('develop')
          await services.sessionProfile.revokeElevation()
        }
        return changed()
      }
    ],
    [
      'settings:setPlanModeDefault',
      async (enabled: boolean) => {
        await services.persistence.setPlanModeDefault(enabled)
        return changed()
      }
    ],
    [
      'settings:setRememberApprovalMode',
      async (enabled: boolean) => {
        await services.persistence.setRememberApprovalMode(enabled)
        return changed()
      }
    ],
    [
      'settings:addProject',
      async (name: string, path: string) => {
        await services.persistence.addProject(name, path)
        await services.openActiveProject()
        return changed()
      }
    ],
    [
      'settings:addRemoteProject',
      async (name: string, path: string, vpsId: string) => {
        await services.persistence.addProject(name, path, { type: 'remote', vpsId })
        await services.openActiveProject()
        return changed()
      }
    ],
    [
      'settings:removeProject',
      async (id: string) => {
        await services.persistence.removeProject(id)
        await services.openActiveProject()
        return changed()
      }
    ],
    [
      'settings:updateProjectPath',
      async (id: string, path: string) => {
        await services.persistence.updateProjectPath(id, path)
        await services.openActiveProject()
        return changed()
      }
    ],

    [
      'dialog:pickDirectory',
      async () => {
        const window = getWindow()
        const result = await (window
          ? dialog.showOpenDialog(window, { properties: ['openDirectory', 'createDirectory'] })
          : dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] }))
        return result.canceled ? null : (result.filePaths[0] ?? null)
      }
    ],
    [
      'attachments:register',
      (paths: string[]) =>
        services.attachments
          .register(Array.isArray(paths) ? paths : [])
          .then((refs) => refs.map(toAttachmentRefView))
    ],
    [
      'dialog:pickFile',
      async () => {
        const window = getWindow()
        const result = await (window
          ? dialog.showOpenDialog(window, {
              properties: ['openFile', 'multiSelections']
            })
          : dialog.showOpenDialog({ properties: ['openFile', 'multiSelections'] }))
        return result.canceled ? [] : result.filePaths
      }
    ],

    [
      'projects:open',
      async (id: string) => {
        await services.persistence.setActiveProject(id)
        await services.openActiveProject()
        return changed()
      }
    ],

    ['projects:getMetadata', (id: string) => services.getProjectMetadata(id)],
    [
      'projects:updateMetadata',
      async (id: string, patch: ProjectMetadataPatch) => {
        await services.persistence.updateProjectMetadata(id, patch)
        return changed()
      }
    ],

    ['customProviders:list', () => services.customProviders.list()],
    ['customProviders:save', (input: CustomProviderInput) => services.customProviders.save(input)],
    ['customProviders:remove', (id: string) => services.customProviders.remove(id)],
    ['customProviders:test', (input: CustomProviderInput) => services.customProviders.test(input)],

    ['onboarding:get', () => services.onboarding.load()],
    ['onboarding:complete', () => services.onboarding.complete()],

    /*
     * Auto-update (v3.0). The app had none. `check` only reads the public Releases API;
     * `download` fetches the installer and verifies it against the release's published
     * SHA256SUMS.txt before anything is executed; `install` starts the NSIS installer and
     * the caller quits the app so its files can be replaced.
     */
    /*
     * Project memory (v3.1). Reading and forgetting are cheap and read-only from the app's point
     * of view; learning makes one bounded model call, so it is a deliberate user action.
     */
    ['facts:list', () => services.agent.projectFacts()],
    ['facts:learn', (chatId: string) => services.learnFactsFromChat(String(chatId ?? ''))],
    ['facts:forget', (factId: string) => services.agent.forgetFact(String(factId ?? ''))],
    ['facts:clear', () => services.agent.clearFacts()],

    ['update:check', () => services.updates.check()],
    ['update:download', () => services.updates.download()],
    ['update:install', () => services.updates.install()],

    ['github:status', () => services.github.status()],
    // v2.8.1: the `gh` CLI is very often already installed and logged in, so the
    // one-click path is offered first. `detectCli` only reads (never the token);
    // `connectCli` reads the token, validates it with `GET /user` and stores it
    // encrypted through setToken — the token never crosses this boundary.
    ['github:detectCli', () => services.github.detectCli()],
    ['github:connectCli', () => services.github.connectWithCli()],
    ['github:setClientId', (clientId: string) => services.github.setClientId(clientId)],
    ['github:setToken', (token: string) => services.github.setToken(token)],
    ['github:startAuth', () => services.github.startAuth()],
    ['github:pollAuth', (deviceCode: string) => services.github.pollAuth(deviceCode)],
    ['github:logout', () => services.github.logout()],
    ['github:repos', () => services.github.listRepos()],
    [
      'github:pulls',
      (owner: string, repo: string, state: string | undefined) =>
        services.github.listPulls(owner, repo, state ?? 'open')
    ],
    [
      'github:issues',
      (owner: string, repo: string, state: string | undefined) =>
        services.github.listIssues(owner, repo, state ?? 'open')
    ],
    ['github:gitStatus', (cwd: string) => services.github.gitStatus(cwd)],
    ['github:gitClone', (url: string, target: string) => services.github.gitClone(url, target)],
    ['github:gitPull', (cwd: string) => services.github.gitPull(cwd)],
    ['github:gitPush', (cwd: string) => services.github.gitPush(cwd)],
    ['github:gitCommit', (cwd: string, input: GitCommitInput) => services.github.gitCommit(cwd, input)],
    [
      'github:gitCheckout',
      (cwd: string, branch: string, create: boolean | undefined) =>
        services.github.gitCheckout(cwd, branch, create ?? false)
    ],

    ['files:list', (path: string | undefined) => services.files.list(path ?? '.')],
    ['files:read', (path: string) => services.files.read(path)],
    [
      'files:write',
      async (path: string, content: string) => {
        await services.files.write(path, content)
        filesChanged()
      }
    ],
    [
      'files:create',
      async (path: string, type: 'file' | 'dir') => {
        await services.files.create(path, type)
        filesChanged()
      }
    ],
    [
      'files:remove',
      async (path: string) => {
        await services.files.remove(path)
        filesChanged()
      }
    ],
    [
      'files:reveal',
      async (path: string) => {
        shell.showItemInFolder(services.files.resolveSafe(path))
      }
    ],

    ['agent:run', (request: AgentRunRequest) => services.agent.run(request)],
    ['agent:abort', () => services.agent.abort()],
    ['agent:respondApproval', (id: string, answer: boolean | ApprovalOutcome) => services.approvals.resolve(id, answer)],
    ['agent:respondPlan', (id: string, decision: PlanDecision) => services.plans.resolve(id, decision)],
    ['agent:respondQuestion', (id: string, answer: string | null) => services.questions.resolve(id, answer)],
  ['agent:respondPreflight', (id: string, choice: PreflightChoice) => services.preflights.resolve(id, choice)],
    ['agent:stopPlan', (runId?: string) => services.agent.stopPlan(runId)],
    ['agent:approvalHistory', () => services.approvals.history()],
    ['agent:approvedCommands', () => services.approvedCommands.list()],
    ['agent:revokeApprovedCommand', (id: string) => services.approvedCommands.revoke(id)],
    [
      'agent:rememberApprovalTool',
      async (tool: string) => {
        // Sensitive tools can never be "always allowed" (P0-3).
        if (!canRememberTool(tool)) return
        const project = services.persistence.getActiveProject()
        if (project) {
          await services.approvedCommands.rememberScoped(
            createRememberedApproval(tool, project.vpsId ?? '', project.id)
          )
          return
        }
        await services.approvedCommands.rememberTool(tool)
      }
    ],
    ['agent:applyChange', (id: string) => services.agent.applyChange(id)],
    // v2.6.5: one source of truth for the version shown in the UI. Settings →
    // Developer hardcoded "v2.3.3" in a 2.6.4 build.
    ['app:version', () => app.getVersion()],
    // v2.6.5: the local terminal now passes the same guards as every remote
    // command and records what ran on the user's own machine.
    [
      'shell:exec',
      (command: string) =>
        runLocalCommand(command, {
          cwd: services.files.getRoot(),
          audit: (entry) => {
            void services.vps
              .recordAudit({
                type: 'exec',
                ok: entry.ok,
                command: `local: ${entry.command}`,
                ...(entry.detail ? { detail: entry.detail } : {})
              })
              .catch(() => undefined)
          }
        })
    ],
    ['search:code', (query: string) => {
      const root = services.files.getRoot()
      if (!root) throw new Error('No active project. Add or select a project first.')
      return searchProject(root, query)
    }],
    ['agent:rejectChange', (id: string) => services.agent.rejectChange(id)],
    ['agent:sessions', () => services.agent.listSessions()],
    ['agent:loadSession', (id: string) => services.agent.loadSession(id)],
    ['agent:memory', (id: string) => services.agent.memory(id)],
    ['agent:clearMemory', (id: string) => services.agent.clearMemory(id)],
    // v2.6.2 (T3.2): explain one trace decision of a run ("Ask Why"). Deterministic.
    [
      'agent:explainStep',
      (runId: string, decisionId: string) => services.agent.explainStep(runId, decisionId)
    ],

    // v2.6.2 (T3.3): audit mode. The path is shown in Settings → Advanced, and
    // Verify recomputes the hash chain to surface tampering.
    ['audit:path', () => services.agent.auditPath()],
    ['audit:verify', () => services.agent.verifyAudit()],

    // v2.6.2 (T4.4): a project's goals are edited from the renderer. The project
    // defaults to the active one; every mutation notifies all windows.
    ['agent:goal:list', (projectId?: string) => services.goals.list(goalProject(projectId))],
    ['agent:goal:resolve', (projectId?: string) =>
      services.goals.resolveGoalId(goalProject(projectId))],
    [
      'agent:goal:create',
      async (input: NewGoalInput, projectId?: string) => {
        const id = goalProject(projectId)
        const goal = await services.goals.create(id, input)
        services.emitGoalChanged(id, goal.id)
        return goal
      }
    ],
    [
      'agent:goal:update',
      async (goalId: string, patch: GoalUpdate, projectId?: string) => {
        const id = goalProject(projectId)
        const goal = await services.goals.update(id, goalId, patch)
        services.emitGoalChanged(id, goalId)
        return goal
      }
    ],
    [
      'agent:goal:setCriterion',
      async (goalId: string, criterionId: string, met: boolean, projectId?: string) => {
        const id = goalProject(projectId)
        const goal = await services.goals.setCriterion(id, goalId, criterionId, met)
        services.emitGoalChanged(id, goalId)
        return goal
      }
    ],
    [
      'agent:goal:setActive',
      async (goalId: string | null, projectId?: string) => {
        const id = goalProject(projectId)
        await services.goals.setActive(id, goalId)
        services.emitGoalChanged(id, goalId ?? undefined)
        return true
      }
    ],
    [
      'agent:goal:achieve',
      async (goalId: string, projectId?: string) => {
        const id = goalProject(projectId)
        const goal = await services.goals.achieve(id, goalId)
        services.emitGoalChanged(id, goalId)
        return goal
      }
    ],
    [
      'agent:goal:abandon',
      async (goalId: string, note?: string, projectId?: string) => {
        const id = goalProject(projectId)
        const goal = await services.goals.abandon(id, goalId, note)
        services.emitGoalChanged(id, goalId)
        return goal
      }
    ],
    [
      'agent:goal:delete',
      async (goalId: string, projectId?: string) => {
        const id = goalProject(projectId)
        const removed = await services.goals.delete(id, goalId)
        services.emitGoalChanged(id, goalId)
        return removed
      }
    ],

    ['jobs:list', () => services.jobs.listJobs()],
    ['jobs:refresh', () => services.jobs.refreshAll()],
    ['jobs:status', (id: string) => {
      const job = services.jobs.getJob(id)
      return job ? services.jobs.getJobStatus(job.vpsId, id) : undefined
    }],
    ['jobs:kill', (id: string) => {
      const job = services.jobs.getJob(id)
      return job ? services.jobs.killJob(job.vpsId, id) : false
    }],

    ['worker:submit', (request: WorkerJobRequest) => services.worker.enqueue(request)],
    ['worker:cancel', (id: string) => services.worker.cancel(id)],
    ['worker:status', () => services.worker.getStatus()],
    ['worker:setOnline', (online: boolean) => {
      services.worker.setOnline(online)
      return services.worker.getStatus()
    }],

    ['remote:start', () => services.remote.start()],
    ['remote:stop', () => services.remote.stop().then(() => services.remote.getStatus())],
    ['remote:status', () => services.remote.getStatus()],

    // v2.5.3: user-controlled, in-memory read-only widening of P0-2.
    ['diagnostic:status', () => services.diagnosticStatus()],
    ['diagnostic:enable', () => services.enableDiagnosticMode()],
    ['diagnostic:disable', () => services.disableDiagnosticMode()],

    // v2.6.2 (Topic 1): Session Profile + main-side elevation grant (P0-5).
    ['session:get', () => services.sessionProfile.state()],
    [
      'session:setProfile',
      async (profile: SessionProfile) => {
        await services.setSessionProfile(profile)
        return changed()
      }
    ],
    [
      'session:setInvestigateScope',
      async (scope: InvestigateScope) => {
        await services.setInvestigateScope(scope)
        return changed()
      }
    ],
    [
      'session:grantElevation',
      async () => {
        await services.grantElevation()
        return changed()
      }
    ],
    [
      'session:revokeElevation',
      async () => {
        await services.revokeElevation()
        return changed()
      }
    ]
  ]

  for (const [channel, handler] of handlers) {
    ipcMain.handle(channel, (_event, ...args) => handler(...(args as never[])))
  }

  const windowOf = (event: Electron.IpcMainInvokeEvent): BrowserWindow | null =>
    BrowserWindow.fromWebContents(event.sender) ?? getWindow()

  const windowChannels: Array<
    [string, (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown]
  > = [
    ['window:minimize', (event) => windowOf(event)?.minimize()],
    [
      'window:toggleMaximize',
      (event) => {
        const window = windowOf(event)
        if (!window) return false
        if (window.isMaximized()) window.unmaximize()
        else window.maximize()
        return window.isMaximized()
      }
    ],
    ['window:close', (event) => windowOf(event)?.close()],
    ['window:isMaximized', (event) => windowOf(event)?.isMaximized() ?? false],
    [
      'window:zoom',
      (event, level) => {
        const window = windowOf(event)
        if (!window) return 0
        // v2.6.2 T5.3: Electron zoom level; 0 is 100%. Clamp so the UI stays usable.
        const value = typeof level === 'number' && Number.isFinite(level) ? level : 0
        const clamped = Math.min(3, Math.max(-3, value))
        window.webContents.setZoomLevel(clamped)
        return clamped
      }
    ],
    ['window:new', () => {
      openWindow()
      return true
    }]
  ]

  for (const [channel, handler] of windowChannels) {
    ipcMain.handle(channel, (event, ...args) => handler(event, ...args))
  }

  const disposeVps = registerVpsIpc(services)

  return () => {
    disposeVps()
    for (const [channel] of handlers) ipcMain.removeHandler(channel)
    for (const [channel] of windowChannels) ipcMain.removeHandler(channel)
  }
}
