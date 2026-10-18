import { ipcMain } from 'electron'
import type { McpServerInput, McpServerStatus, McpServerView } from '@shared/mcp'
import type { AppServices } from './app-services'

/**
 * IPC surface for MCP servers (F0-2d).
 *
 * Kept out of `ipc.ts` for the same reason `vps-ipc.ts` is: a feature with its own store, its own
 * channels and its own cleanup reads better in one file, and registering it here keeps the
 * privileged surface of the app in one obvious place per feature.
 *
 * The rule that matters most: **`McpServerConfig` never crosses this bridge.** It carries the
 * `env` block, which is exactly where a token lives, so the renderer only ever receives
 * `McpServerView` — id, name, launch line, enabled state, tool count or error. Saving accepts an
 * `McpServerInput`, so the environment goes in and is never read back out.
 */
export function registerMcpIpc(services: AppServices): () => void {
  const handlers: Array<[string, (...args: never[]) => unknown]> = [
    ['mcp:list', (): Promise<McpServerView[]> => services.mcpServerViews()],
    ['mcp:save', (input: McpServerInput): Promise<McpServerView[]> => services.saveMcpServer(input)],
    ['mcp:remove', (id: string): Promise<McpServerView[]> => services.removeMcpServer(id)],
    [
      'mcp:setEnabled',
      (id: string, enabled: boolean): Promise<McpServerView[]> =>
        services.setMcpServerEnabled(id, enabled)
    ],
    // The last run's observation, or `disconnected` for a server nothing has opened yet.
    ['mcp:status', (): Promise<McpServerStatus[]> => services.mcpStatuses()]
  ]

  for (const [channel, handler] of handlers) {
    ipcMain.handle(channel, (_event, ...args) => handler(...(args as never[])))
  }

  return () => {
    for (const [channel] of handlers) ipcMain.removeHandler(channel)
  }
}
