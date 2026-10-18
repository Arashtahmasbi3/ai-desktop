import i18n from '../i18n'
import type { ApprovalOutcome } from '@shared/approval'
import type { StoreSet, StoreGet } from './helpers'
import type { AppState } from './types'

/** Full access auto-reverts to Ask after this much idle time (v2.3, B.2). */
const FULL_ACCESS_TTL_MS = 30 * 60 * 1000
let fullAccessTimer: ReturnType<typeof setTimeout> | null = null

export function approvalActions(
  set: StoreSet,
  get: StoreGet
): Pick<
  AppState,
  | 'setApprovalMode'
  | 'setRememberApprovalMode'
  | 'setCheckpointMode'
  | 'setPlanModeDefault'
  | 'respondApproval'
  | 'respondPlan'
  | 'respondPreflight'
  | 'respondQuestion'
  | 'stopPlan'
  | 'rememberApprovalTool'
  | 'dismissApprovalSuggestion'
  | 'applyFileChange'
  | 'rejectFileChange'
> {
  return {
    async setApprovalMode(mode) {
      set({ settings: await window.api.settings.setApprovalMode(mode) })
      if (mode === 'full') {
        const expiresAt = Date.now() + FULL_ACCESS_TTL_MS
        set({ fullAccessExpiresAt: expiresAt })
        if (fullAccessTimer) clearTimeout(fullAccessTimer)
        fullAccessTimer = setTimeout(() => {
          void get().setApprovalMode('ask')
          get().pushToast('warning', 'Full access turned off after 30 minutes of inactivity.')
        }, FULL_ACCESS_TTL_MS)
        fullAccessTimer.unref?.()
      } else {
        set({ fullAccessExpiresAt: null })
        if (fullAccessTimer) {
          clearTimeout(fullAccessTimer)
          fullAccessTimer = null
        }
      }
    },

    async setRememberApprovalMode(enabled) {
      set({ settings: await window.api.settings.setRememberApprovalMode(enabled) })
    },

    async setCheckpointMode(mode) {
      set({ settings: await window.api.settings.setCheckpointMode(mode) })
    },

    async setPlanModeDefault(value) {
      set({ settings: await window.api.settings.setPlanModeDefault(value) })
    },

    async respondApproval(answer) {
      const pending = get().pendingApproval
      if (!pending) return
      const outcome: ApprovalOutcome =
        typeof answer === 'boolean' ? { approved: answer } : answer
      // U-5: only clear the gate once main has accepted the answer. Clearing it
      // optimistically made a failed reply look like a decision, while the run
      // hung until main's 2-minute fail-closed timeout with no visible error.
      try {
        await window.api.agent.respondApproval(pending.id, answer)
      } catch (error) {
        get().pushToast(
          'error',
          `${i18n.t('toast.actionFailed')} ${error instanceof Error ? error.message : String(error)}`
        )
        return
      }
      if (outcome.explain) {
        set({
          queuedExplain:
            `You tried to ${pending.summary}, but I denied it. ` +
            'Explain why you wanted to do that and propose a safer alternative.'
        })
      }
      set({ pendingApproval: null })
    },

    async respondPlan(decision) {
      const pending = get().pendingPlan
      if (!pending) return
      try {
        await window.api.agent.respondPlan(pending.id, decision)
      } catch (error) {
        get().pushToast(
          'error',
          `${i18n.t('toast.actionFailed')} ${error instanceof Error ? error.message : String(error)}`
        )
        return
      }
      set({ pendingPlan: null })
    },

    async respondPreflight(choice) {
      const pending = get().pendingPreflight
      if (!pending) return
      try {
        await window.api.agent.respondPreflight(pending.id, choice)
      } catch (error) {
        get().pushToast(
          'error',
          `${i18n.t('toast.actionFailed')} ${error instanceof Error ? error.message : String(error)}`
        )
        return
      }
      set({ pendingPreflight: null })
    },

    /**
     * v2.8.0: answer a mid-run question. The run is already awaiting this answer, so
     * success resumes the *same* run — no new message, no new run, same sandbox.
     */
    async respondQuestion(answer) {
      const pending = get().pendingQuestion
      if (!pending) return
      try {
        await window.api.agent.respondQuestion(pending.id, answer)
      } catch (error) {
        get().pushToast(
          'error',
          `${i18n.t('toast.actionFailed')} ${error instanceof Error ? error.message : String(error)}`
        )
        return
      }
      set({ pendingQuestion: null })
    },

    stopPlan() {
      set({ activePlan: null })
      void window.api.agent.stopPlan()
    },

    async rememberApprovalTool(tool) {
      await window.api.agent.rememberApprovalTool(tool)
      set({ approvalSuggestion: null })
      get().pushToast('success', `Always allowing ${tool}.`)
    },

    dismissApprovalSuggestion() {
      set({ approvalSuggestion: null })
    },

    async applyFileChange(id) {
      const ok = await window.api.agent.applyChange(id)
      if (ok) {
        set({ fileChanges: get().fileChanges.filter((change) => change.id !== id) })
        void get().refreshFiles()
      }
    },

    async rejectFileChange(id) {
      const ok = await window.api.agent.rejectChange(id)
      if (ok) set({ fileChanges: get().fileChanges.filter((change) => change.id !== id) })
    },
  }
}
