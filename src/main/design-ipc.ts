import { ipcMain, shell } from 'electron'
import { isAbsolute, join, normalize, sep } from 'node:path'
import type { DesignAnswers, DesignProject, DesignSummary } from '@shared/design'
import type { DesignStore } from './design-store'
import { buildDesign, type BuildResult } from './design-build/build'

/**
 * IPC surface for Art Board projects (phase 0–3).
 *
 * Same shape as `mcp-ipc.ts`: a feature-owned file with its own channels and cleanup. The store is injected so the
 * channels can be tested without touching the real app data directory, and `design:openPath` only opens a path the
 * store itself owns — the renderer cannot ask the app to open an arbitrary file.
 */
export function registerDesignIpc(store: DesignStore): () => void {
  const insideRoot = (path: string): string => {
    const root = normalize(store.root)
    const absolute = isAbsolute(path) ? normalize(path) : normalize(join(root, path))
    if (absolute !== root && !absolute.startsWith(root + sep)) {
      throw new Error('مسیر بیرون از پروژه‌های طراحی است.')
    }
    return absolute
  }

  const handlers: Array<[string, (...args: never[]) => unknown]> = [
    ['design:list', (): Promise<DesignSummary[]> => store.list()],
    ['design:create', (answers: DesignAnswers): Promise<DesignProject> => store.create(answers)],
    ['design:get', (id: string): Promise<DesignProject | null> => store.get(id)],
    ['design:save', (design: DesignProject): Promise<DesignProject> => store.save(design)],
    ['design:remove', (id: string): Promise<boolean> => store.remove(id)],
    [
      'design:build',
      async (design: DesignProject): Promise<BuildResult> => {
        const saved = await store.save(design)
        return buildDesign(saved, { root: join(store.root, saved.id) })
      }
    ],
    [
      'design:openPath',
      async (path: string): Promise<string> => shell.openPath(insideRoot(path))
    ]
  ]

  for (const [channel, handler] of handlers) {
    ipcMain.handle(channel, (_event, ...args) => handler(...(args as never[])))
  }

  return () => {
    for (const [channel] of handlers) ipcMain.removeHandler(channel)
  }
}
