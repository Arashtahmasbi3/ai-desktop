import { ipcMain } from 'electron'
import type { VpsServerInput } from '@shared/vps'
import type { AppServices } from './app-services'

/** POSIX single-quote a value so it can be safely embedded in a shell command. */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

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
    ['vps:searchProject', (id: string, name: string) => searchRemoteProject(services, id, name)],
    ['vps:listDirs', (id: string, path: string) => listRemoteDirs(services, id, path)],
    ['vps:gitStatus', (id: string, path: string) => remoteGitStatus(services, id, path)],
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
