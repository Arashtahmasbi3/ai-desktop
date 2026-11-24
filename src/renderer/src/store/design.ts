import i18n from '../i18n'
import type { DesignAnswers, DesignProject } from '@shared/design'
import type { StoreSet, StoreGet } from './helpers'
import type { AppState } from './types'

/**
 * Art Board state (phase 0).
 *
 * The store holds the project list and the one open design; every mutation goes through `window.api.design.*` and the
 * renderer never writes a file itself. Errors become a toast — a user who clicked "بساز" must see why nothing happened.
 */
export function designActions(
  set: StoreSet,
  get: StoreGet
): Pick<
  AppState,
  | 'refreshDesigns'
  | 'createDesign'
  | 'openDesign'
  | 'saveDesign'
  | 'closeDesign'
  | 'removeDesign'
> {
  return {
    async refreshDesigns() {
      set({ designBusy: true })
      try {
        set({ designProjects: await window.api.design.list() })
      } catch (error) {
        get().pushToast('error', `${i18n.t('toast.actionFailed')} ${messageOf(error)}`)
      } finally {
        set({ designBusy: false })
      }
    },

    async createDesign(answers: DesignAnswers) {
      set({ designBusy: true })
      try {
        const design = await window.api.design.create(answers)
        set({ activeDesign: design, designProjects: await window.api.design.list() })
        get().pushToast('success', i18n.t('design.created'))
        return design
      } catch (error) {
        get().pushToast('error', `${i18n.t('toast.actionFailed')} ${messageOf(error)}`)
        return null
      } finally {
        set({ designBusy: false })
      }
    },

    async openDesign(id: string) {
      set({ designBusy: true })
      try {
        const design = await window.api.design.get(id)
        if (design) set({ activeDesign: design })
      } catch (error) {
        get().pushToast('error', `${i18n.t('toast.actionFailed')} ${messageOf(error)}`)
      } finally {
        set({ designBusy: false })
      }
    },

    async saveDesign(design: DesignProject) {
      try {
        const saved = await window.api.design.save(design)
        set({ activeDesign: saved })
        return saved
      } catch (error) {
        get().pushToast('error', `${i18n.t('toast.actionFailed')} ${messageOf(error)}`)
        return null
      }
    },

    closeDesign() {
      set({ activeDesign: null })
    },

    async removeDesign(id: string) {
      try {
        await window.api.design.remove(id)
        set({
          designProjects: await window.api.design.list(),
          ...(get().activeDesign?.id === id ? { activeDesign: null } : {})
        })
      } catch (error) {
        get().pushToast('error', `${i18n.t('toast.actionFailed')} ${messageOf(error)}`)
      }
    }
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
