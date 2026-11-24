import { ipcMain } from 'electron'
import type { DesignAnswers, DesignProject, DesignSummary } from '@shared/design'
import type { DesignStore } from './design-store'

/**
 * IPC surface for Art Board projects (phase 0).
 *
 * Same shape as `mcp-ipc.ts`: a feature-owned file with its own channels and cleanup, so the privileged surface stays
 * one obvious place per feature. The store is injected so the channels can be tested without touching the real app
 * data directory.
 */
export function registerDesignIpc(store: DesignStore): () => void {
  const handlers: Array<[string, (...args: never[]) => unknown]> = [
    ['design:list', (): Promise<DesignSummary[]> => store.list()],
    ['design:create', (answers: DesignAnswers): Promise<DesignProject> => store.create(answers)],
    ['design:get', (id: string): Promise<DesignProject | null> => store.get(id)],
    ['design:save', (design: DesignProject): Promise<DesignProject> => store.save(design)],
    ['design:remove', (id: string): Promise<boolean> => store.remove(id)]
  ]

  for (const [channel, handler] of handlers) {
    ipcMain.handle(channel, (_event, ...args) => handler(...(args as never[])))
  }

  return () => {
    for (const [channel] of handlers) ipcMain.removeHandler(channel)
  }
}
