import { ipcMain } from 'electron'
import type { VpsServerInput } from '@shared/vps'
import type { AppServices } from './app-services'

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
    ['vps:connect', (id: string) => services.vps.connect(id)],
    ['vps:disconnect', (id: string) => services.vps.disconnect(id)],
    ['vps:approveFingerprint', (id: string) => services.vps.approveFingerprint(id)],
    ['vps:exec', (id: string, command: string) => services.vps.exec(id, command)],
    ['vps:audit', () => services.vps.auditEntries()],
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
    ['vps:files:list', (id: string, path: string) => services.vps.listFiles(id, path)],
    ['vps:files:read', (id: string, path: string) => services.vps.readFile(id, path)],
    [
      'vps:files:write',
      (id: string, path: string, content: string) => services.vps.writeFile(id, path, content)
    ]
  ]

  for (const [channel, handler] of handlers) {
    ipcMain.handle(channel, (_event, ...args) => handler(...(args as never[])))
  }

  return () => {
    for (const [channel] of handlers) ipcMain.removeHandler(channel)
  }
}
