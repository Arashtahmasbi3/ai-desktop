import i18n from '../i18n'
import type { StoreSet, StoreGet } from './helpers'
import type { AppState } from './types'

/**
 * The working checklist in the renderer (T04) and the deliverables the agent presented (T11).
 *
 * Both are read on demand: the panel asks when it opens. Both are written by the agent in main, so the renderer never
 * edits them and cannot disagree with what the model was told it wrote.
 */
export function todoActions(
  set: StoreSet,
  get: StoreGet
): Pick<AppState, 'refreshTodos' | 'refreshPresented'> {
  const fail = (error: unknown): void => {
    const message = error instanceof Error ? error.message : String(error)
    get().pushToast('error', `${i18n.t('toast.actionFailed')} ${message}`)
  }

  return {
    async refreshTodos() {
      try {
        const list = await window.api.todos.list()
        set({ todos: list.items })
      } catch (error) {
        fail(error)
      }
    },

    async refreshPresented() {
      try {
        const list = await window.api.presented.list()
        set({ presented: list.items })
      } catch (error) {
        fail(error)
      }
    }
  }
}
