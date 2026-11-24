import i18n from '../i18n'
import type { StoreSet, StoreGet } from './helpers'
import type { AppState } from './types'

/**
 * The working checklist in the renderer (T04).
 *
 * Read on demand: the panel asks when it opens. The list is written by the agent through `todo_write` in main, so the
 * renderer never edits it and cannot disagree with what the model was told it wrote.
 */
export function todoActions(set: StoreSet, get: StoreGet): Pick<AppState, 'refreshTodos'> {
  return {
    async refreshTodos() {
      try {
        const list = await window.api.todos.list()
        set({ todos: list.items })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        get().pushToast('error', `${i18n.t('toast.actionFailed')} ${message}`)
      }
    }
  }
}
