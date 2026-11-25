import type { ScheduleJob } from '@shared/schedule'
import type { StoreSet } from './helpers'
import type { AppState } from './types'

/**
 * Scheduled jobs in the renderer (T16).
 *
 * The store owns only the list; the recurrence arithmetic stays in `@shared/schedule` and the execution stays in main. That
 * keeps "when should this run" and "did it run" answerable in one place each.
 */
export function scheduleActions(set: StoreSet): Pick<
  AppState,
  'schedules' | 'loadSchedules' | 'saveSchedule' | 'removeSchedule'
> {
  return {
    schedules: [],

    async loadSchedules() {
      set({ schedules: await window.api.schedules.list() })
    },

    async saveSchedule(job: ScheduleJob) {
      set({ schedules: await window.api.schedules.save(job) })
    },

    async removeSchedule(id: string) {
      set({ schedules: await window.api.schedules.remove(id) })
    }
  }
}
