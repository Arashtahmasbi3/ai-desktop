import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import type { CustomProviderInput, ProviderId } from '@shared/types'
import type { ApprovalMode } from '@shared/approval'
import type { GitCommitInput } from '@shared/github'
import type { AgentRunRequest, WorkerJobRequest } from '@shared/ui'
import type { AppServices } from './app-services'
import { registerVpsIpc } from './vps-ipc'

/**
 * Registers every IPC channel the renderer is allowed to call. Handlers only
 * expose the curated service methods — the renderer never gets direct access to
 * Node, the filesystem or child processes.
 */
export function registerIpc(services: AppServices, getWindow: () => BrowserWindow | null): () => void {
  const send = (channel: string, payload: unknown): void => {
    getWindow()?.webContents.send(channel, payload)
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

  const handlers: Array<[string, (...args: never[]) => unknown]> = [
    ['app:ping', () => 'pong'],

    ['chats:list', () => services.chats.list()],
    ['chats:load', (id: string) => services.chats.load(id)],
    [
      'chats:save',
      (input: Parameters<typeof services.chats.save>[0]) => services.chats.save(input)
    ],
    ['chats:rename', (id: string, title: string) => services.chats.rename(id, title)],
    ['chats:remove', (id: string) => services.chats.remove(id)],

    ['window:minimize', () => getWindow()?.minimize()],
    [
      'window:toggleMaximize',
      () => {
        const window = getWindow()
        if (!window) return false
        if (window.isMaximized()) window.unmaximize()
        else window.maximize()
        return window.isMaximized()
      }
    ],
    ['window:close', () => getWindow()?.close()],
    ['window:isMaximized', () => getWindow()?.isMaximized() ?? false],

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
        await services.persistence.setApprovalMode(mode)
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

    ['customProviders:list', () => services.customProviders.list()],
    ['customProviders:save', (input: CustomProviderInput) => services.customProviders.save(input)],
    ['customProviders:remove', (id: string) => services.customProviders.remove(id)],
    ['customProviders:test', (input: CustomProviderInput) => services.customProviders.test(input)],

    ['onboarding:get', () => services.onboarding.load()],
    ['onboarding:complete', () => services.onboarding.complete()],

    ['github:status', () => services.github.status()],
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
    ['agent:respondApproval', (id: string, approved: boolean) => services.approvals.resolve(id, approved)],
    ['agent:applyChange', (id: string) => services.agent.applyChange(id)],
    ['agent:rejectChange', (id: string) => services.agent.rejectChange(id)],
    ['agent:sessions', () => services.agent.listSessions()],
    ['agent:loadSession', (id: string) => services.agent.loadSession(id)],

    ['worker:submit', (request: WorkerJobRequest) => services.worker.enqueue(request)],
    ['worker:cancel', (id: string) => services.worker.cancel(id)],
    ['worker:status', () => services.worker.getStatus()],
    ['worker:setOnline', (online: boolean) => {
      services.worker.setOnline(online)
      return services.worker.getStatus()
    }],

    ['remote:start', () => services.remote.start()],
    ['remote:stop', () => services.remote.stop().then(() => services.remote.getStatus())],
    ['remote:status', () => services.remote.getStatus()]
  ]

  for (const [channel, handler] of handlers) {
    ipcMain.handle(channel, (_event, ...args) => handler(...(args as never[])))
  }

  const disposeVps = registerVpsIpc(services)

  return () => {
    disposeVps()
    for (const [channel] of handlers) ipcMain.removeHandler(channel)
  }
}
