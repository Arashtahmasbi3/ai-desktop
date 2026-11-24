import { ipcMain } from 'electron'
import type { PresentedList } from '@shared/deliverable'
import type { PresentedStore } from './presented-store'

/** IPC for the deliverables list (T11). One read channel; the panel asks when it opens. */
export function registerPresentedIpc(store: PresentedStore): () => void {
  const handlers: Array<[string, (...args: never[]) => unknown]> = [
    ['presented:list', (): Promise<PresentedList> => store.read()]
  ]

  for (const [channel, handler] of handlers) {
    ipcMain.handle(channel, (_event, ...args) => handler(...(args as never[])))
  }

  return () => {
    for (const [channel] of handlers) ipcMain.removeHandler(channel)
  }
}
