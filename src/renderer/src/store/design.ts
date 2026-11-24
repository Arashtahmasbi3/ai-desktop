import i18n from '../i18n'
import {
  MODULE_TYPES,
  validateDesign,
  type DesignAnswers,
  type DesignModule,
  type DesignPage,
  type DesignProject
} from '@shared/design'
import type { StoreSet, StoreGet } from './helpers'
import type { AppState } from './types'

/**
 * Art Board state (phase 0 + 1).
 *
 * Two documents, on purpose: `activeDesign` is what is on disk, `designDraft` is what the board is editing. The draft
 * is what undo/redo walks, and the only action that touches the disk is `saveDesignDraft` — so a user can drag ten
 * modules around, press undo a few times and close the board without ever writing a half-finished site.
 *
 * The history cap is 50 snapshots: a board document is small, but unbounded undo in a long session is not a feature.
 */
const MAX_HISTORY = 50
let moduleSeq = 0

function clone(design: DesignProject): DesignProject {
  return structuredClone(design)
}

function newModule(type: string): DesignModule {
  moduleSeq += 1
  return {
    id: `m-new-${moduleSeq}`,
    type,
    props: { ...(MODULE_TYPES[type]?.defaults ?? {}) }
  }
}

function withPage(
  design: DesignProject,
  pageId: string,
  change: (page: DesignPage) => DesignPage
): DesignProject {
  return {
    ...design,
    pages: design.pages.map((page) => (page.id === pageId ? change(page) : page))
  }
}

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
  | 'beginDesignEdit'
  | 'addDesignModule'
  | 'moveDesignModule'
  | 'removeDesignModule'
  | 'updateDesignModule'
  | 'addDesignPage'
  | 'undoDesign'
  | 'redoDesign'
  | 'saveDesignDraft'
> {
  /** Record the current draft in the undo stack and install `next`. */
  const commit = (next: DesignProject): void => {
    const current = get().designDraft
    const past = current ? [...get().designPast, clone(current)].slice(-MAX_HISTORY) : get().designPast
    set({ designDraft: next, designPast: past, designFuture: [], designDirty: true })
  }

  const draftPage = (pageId: string): DesignProject | null => {
    const draft = get().designDraft
    if (!draft || !draft.pages.some((page) => page.id === pageId)) return null
    return draft
  }

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
        set({
          activeDesign: design,
          designDraft: clone(design),
          designPast: [],
          designFuture: [],
          designDirty: false,
          designProjects: await window.api.design.list()
        })
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
        if (design) {
          set({
            activeDesign: design,
            designDraft: clone(design),
            designPast: [],
            designFuture: [],
            designDirty: false
          })
        }
      } catch (error) {
        get().pushToast('error', `${i18n.t('toast.actionFailed')} ${messageOf(error)}`)
      } finally {
        set({ designBusy: false })
      }
    },

    async saveDesign(design: DesignProject) {
      try {
        const saved = await window.api.design.save(design)
        set({ activeDesign: saved, designDraft: clone(saved), designDirty: false })
        return saved
      } catch (error) {
        get().pushToast('error', `${i18n.t('toast.actionFailed')} ${messageOf(error)}`)
        return null
      }
    },

    closeDesign() {
      set({
        activeDesign: null,
        designDraft: null,
        designPast: [],
        designFuture: [],
        designDirty: false
      })
    },

    async removeDesign(id: string) {
      try {
        await window.api.design.remove(id)
        set({
          designProjects: await window.api.design.list(),
          ...(get().activeDesign?.id === id
            ? { activeDesign: null, designDraft: null, designPast: [], designFuture: [], designDirty: false }
            : {})
        })
      } catch (error) {
        get().pushToast('error', `${i18n.t('toast.actionFailed')} ${messageOf(error)}`)
      }
    },

    beginDesignEdit() {
      const design = get().activeDesign
      if (!design) return
      set({
        designDraft: clone(design),
        designPast: [],
        designFuture: [],
        designDirty: false
      })
    },

    addDesignModule(pageId, type, index) {
      const draft = draftPage(pageId)
      if (!draft) return
      if (MODULE_TYPES[type] === undefined) return
      const next = withPage(draft, pageId, (page) => {
        const modules = [...page.modules]
        const at = typeof index === 'number' ? Math.max(0, Math.min(index, modules.length)) : modules.length
        modules.splice(at, 0, newModule(type))
        return { ...page, modules }
      })
      commit(next)
    },

    moveDesignModule(pageId, from, to) {
      const draft = draftPage(pageId)
      if (!draft) return
      const next = withPage(draft, pageId, (page) => {
        if (from < 0 || from >= page.modules.length) return page
        const modules = [...page.modules]
        const [moved] = modules.splice(from, 1)
        if (!moved) return page
        const target = Math.max(0, Math.min(to, modules.length))
        modules.splice(target, 0, moved)
        return { ...page, modules }
      })
      if (next === draft) return
      commit(next)
    },

    removeDesignModule(pageId, moduleId) {
      const draft = draftPage(pageId)
      if (!draft) return
      const next = withPage(draft, pageId, (page) => ({
        ...page,
        modules: page.modules.filter((module) => module.id !== moduleId)
      }))
      commit(next)
    },

    updateDesignModule(pageId, moduleId, patch) {
      const draft = draftPage(pageId)
      if (!draft) return
      const next = withPage(draft, pageId, (page) => ({
        ...page,
        modules: page.modules.map((module) => {
          if (module.id !== moduleId) return module
          const props = { ...module.props }
          if (patch.title !== undefined) props.title = patch.title
          if (patch.text !== undefined) props.text = patch.text
          if (patch.cta !== undefined) props.cta = patch.cta
          return {
            ...module,
            props,
            ...(patch.notes !== undefined ? { notes: patch.notes } : {})
          }
        })
      }))
      commit(next)
    },

    addDesignPage(name) {
      const draft = get().designDraft
      const trimmed = name.trim()
      if (!draft || !trimmed) return
      let index = draft.pages.length + 1
      while (draft.pages.some((page) => page.path === `/p${index}`)) index += 1
      const next: DesignProject = {
        ...draft,
        pages: [
          ...draft.pages,
          {
            id: `page-${index}`,
            name: trimmed,
            path: `/p${index}`,
            role: 'public',
            modules: []
          }
        ]
      }
      commit(next)
    },

    undoDesign() {
      const past = get().designPast
      const current = get().designDraft
      if (!current || past.length === 0) return
      const previous = past[past.length - 1]!
      set({
        designDraft: previous,
        designPast: past.slice(0, -1),
        designFuture: [clone(current), ...get().designFuture].slice(0, MAX_HISTORY),
        designDirty: true
      })
    },

    redoDesign() {
      const future = get().designFuture
      const current = get().designDraft
      if (!current || future.length === 0) return
      const next = future[0]!
      set({
        designDraft: next,
        designFuture: future.slice(1),
        designPast: [...get().designPast, clone(current)].slice(-MAX_HISTORY),
        designDirty: true
      })
    },

    async saveDesignDraft() {
      const draft = get().designDraft
      if (!draft) return false
      const validation = validateDesign(draft)
      if (!validation.ok) {
        get().pushToast('error', validation.problems[0] ?? i18n.t('toast.actionFailed'))
        return false
      }
      const saved = await get().saveDesign(draft)
      return saved !== null
    }
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
