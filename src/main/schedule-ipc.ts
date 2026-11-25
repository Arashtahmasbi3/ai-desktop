import { ipcMain } from 'electron'
import type { ScheduleJob } from '@shared/schedule'
import type { ScheduleStore } from './scheduler'

/**
 * IPC for scheduled jobs (T16, part 1).
 *
 * List/save/remove only. There is deliberately no "run now" channel and no timer in this file: executing a scheduled
 * prompt starts an agent run, and that decision belongs to the service that owns runs, not to a store.
 */
export function registerScheduleIpc(store: ScheduleStore): () => void {
  const handlers: Array<[string, (...args: never[]) => unknown]> = [
    ['schedules:list', (): Promise<ScheduleJob[]> => store.list()],
    ['schedules:save', (job: ScheduleJob): Promise<ScheduleJob[]> => store.save(job)],
    ['schedules:remove', (id: string): Promise<ScheduleJob[]> => store.remove(id)]
  ]

  for (const [channel, handler] of handlers) {
    ipcMain.handle(channel, (_event, ...args) => handler(...(args as never[])))
  }

  return () => {
    for (const [channel] of handlers) ipcMain.removeHandler(channel)
  }
}
