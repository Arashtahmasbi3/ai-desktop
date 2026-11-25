import i18n from '../i18n'
import type { ApprovalOutcome } from '@shared/approval'
import { resolvePermissionPreset, type PermissionPresetId } from '@shared/permission-presets'
import { resolveAgentPreset, type AgentPresetId } from '@shared/agent-presets'
import type { StoreSet, StoreGet } from './helpers'
import type { AppState } from './types'

/** Full access auto-reverts to Ask after this much idle time (v2.3, B.2). */
const FULL_ACCESS_TTL_MS = 30 * 60 * 1000
let fullAccessTimer: ReturnType<typeof setTimeout> | null = null

/**
 * v4.3.14: the deadline used to live only in this module's timer, so a reload or a restart dropped it and
 * "full access" stayed on for ever. The deadline is now persisted and re-armed at boot; walking past it
 * downgrades the mode even if the renderer was closed the whole time.
 */
const FULL_ACCESS_KEY = 'ai-desktop:full-access-until'

function readStoredFullAccessExpiry(): number | null {
  try {
    const raw = window.localStorage.getItem(FULL_ACCESS_KEY)
    if (!raw) return null
    const value = Number(raw)
    return Number.isFinite(value) && value > 0 ? value : null
  } catch {
    return null
  }
}

function writeStoredFullAccessExpiry(expiresAt: number | null): void {
  try {
    if (expiresAt === null) window.localStorage.removeItem(FULL_ACCESS_KEY)
    else window.localStorage.setItem(FULL_ACCESS_KEY, String(expiresAt))
  } catch {
    // Storage can be unavailable (private mode, quota); the in-memory timer still runs.
  }
}

function clearFullAccessTimer(): void {
  if (fullAccessTimer) {
    clearTimeout(fullAccessTimer)
    fullAccessTimer = null
  }
}

function armFullAccessTimer(expiresAt: number, get: StoreGet): void {
  clearFullAccessTimer()
  const remaining = Math.max(0, expiresAt - Date.now())
  fullAccessTimer = setTimeout(() => {
    void get().setApprovalMode('ask')
    get().pushToast('warning', 'Full access turned off after 30 minutes of inactivity.')
  }, remaining)
  fullAccessTimer.unref?.()
}

export function approvalActions(
  set: StoreSet,
  get: StoreGet
): Pick<
  AppState,
  | 'setApprovalMode'
  | 'applyStoredFullAccessExpiry'
  | 'applyPermissionPreset'
  | 'applyAgentPreset'
  | 'setRememberApprovalMode'
  | 'setCheckpointMode'
  | 'setPlanModeDefault'
  | 'setAutoRoute'
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
    async applyAgentPreset(id: AgentPresetId) {      const preset = resolveAgentPreset(id)
      if (!preset) return
      await window.api.session.setProfile(preset.profile)
      await get().setApprovalMode(preset.approvalMode)
      await get().setPlanModeDefault(preset.planMode)
    },

    async applyPermissionPreset(id: PermissionPresetId) {
      const preset = resolvePermissionPreset(id)
      if (!preset) return
      await window.api.session.setProfile(preset.profile)
      await get().setApprovalMode(preset.approvalMode)
    },

    async setApprovalMode(mode) {
      set({ settings: await window.api.settings.setApprovalMode(mode) })
      if (mode === 'full') {
        const expiresAt = Date.now() + FULL_ACCESS_TTL_MS
        set({ fullAccessExpiresAt: expiresAt })
        writeStoredFullAccessExpiry(expiresAt)
        armFullAccessTimer(expiresAt, get)
      } else {
        set({ fullAccessExpiresAt: null })
        writeStoredFullAccessExpiry(null)
        clearFullAccessTimer()
      }
    },

    /**
     * Re-arm the persisted deadline at boot. An expired one is downgraded here rather than trusted, so a
     * restart cannot resurrect a grant the user gave hours ago.
     */
    applyStoredFullAccessExpiry() {
      const expiresAt = readStoredFullAccessExpiry()
      if (expiresAt === null) return
      if (expiresAt <= Date.now()) {
        writeStoredFullAccessExpiry(null)
        set({ fullAccessExpiresAt: null })
        void get().setApprovalMode('ask')
        return
      }
      set({ fullAccessExpiresAt: expiresAt })
      armFullAccessTimer(expiresAt, get)
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

    async setAutoRoute(value) {
      set({ settings: await window.api.settings.setAutoRoute(value) })
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
