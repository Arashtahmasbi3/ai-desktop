import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import type { ProviderId } from '@shared/types'
import type { AgentRunRequest, WorkerJobRequest } from '@shared/ui'
import type { AppServices } from './app-services'

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
      'settings:addProject',
      async (name: string, path: string) => {
        await services.persistence.addProject(name, path)
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
      'projects:open',
      async (id: string) => {
        await services.persistence.setActiveProject(id)
        await services.openActiveProject()
        return changed()
      }
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

  return () => {
    for (const [channel] of handlers) ipcMain.removeHandler(channel)
  }
}
