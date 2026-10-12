/**
 * Main-process authority for the Session Profile + elevation grant
 * (v2.6.2, Topic 1 / P0-5).
 *
 * Prior to v2.6.2 `full` access was decided in the renderer: the TTL timer lived
 * in the renderer store, so a renderer reload (or a crash) silently restored
 * `full` and the grant became effectively permanent. Here the grant is owned,
 * scoped and expired by main; the renderer may only *ask*. A persisted `full`
 * preference without a valid grant resolves to at most `auto-write`.
 */
import {
  createElevationGrant,
  isGrantValid,
  resolveSessionProfile,
  type ElevationGrant,
  type InvestigateScope,
  type ProfileScope,
  type ResolvedProfile,
  type SessionProfile
} from '@shared/profile'
import { DEFAULT_PROJECT_ENVIRONMENT } from '@shared/project-metadata'
import type { Persistence } from '@core/agent/persistence'

export interface SessionProfileServiceOptions {
  /** Called whenever the effective profile changes (including expiry). */
  onChanged?: (state: ResolvedProfile) => void
  /** Injectable clock (tests). */
  now?: () => number
}

export class SessionProfileService {
  private readonly persistence: Persistence
  private readonly onChanged: (state: ResolvedProfile) => void
  private readonly now: () => number
  private timer: ReturnType<typeof setTimeout> | null = null
  private disposed = false

  constructor(persistence: Persistence, options: SessionProfileServiceOptions = {}) {
    this.persistence = persistence
    this.onChanged = options.onChanged ?? (() => undefined)
    this.now = options.now ?? (() => Date.now())
  }

  /**
   * Re-arm the expiry timer for a grant persisted before this launch. Without
   * this a restart would leave an expired grant honored until the next write.
   * A grant that is already invalid is dropped from disk so `state()` and the
   * persisted file cannot disagree.
   */
  async init(): Promise<void> {
    await this.persistence.load()
    const grant = this.persistence.getElevationGrant()
    if (!grant) return
    if (isGrantValid(grant, await this.scope(), this.now())) {
      this.scheduleExpiry(grant.expiresAt)
    } else {
      await this.revokeGrant()
    }
  }

  dispose(): void {
    this.disposed = true
    this.clearTimer()
  }

  /** The scope a grant must match: active project + VPS + environment. */
  async scope(): Promise<ProfileScope> {
    await this.persistence.load()
    const project = this.persistence.getActiveProject()
    return {
      ...(project ? { projectId: project.id } : {}),
      ...(project?.vpsId ? { vpsId: project.vpsId } : {}),
      environment: project?.environment ?? DEFAULT_PROJECT_ENVIRONMENT
    }
  }

  /** The effective, grant-validated profile. Safe to call at any time. */
  async state(): Promise<ResolvedProfile> {
    const settings = await this.persistence.load()
    const grant = this.persistence.getElevationGrant() ?? null
    return resolveSessionProfile(settings, grant, await this.scope(), this.now())
  }

  /**
   * Switch profile. Entering `elevated` deliberately does **not** grant
   * anything — it must stay inert until an explicit {@link grantElevation}.
   */
  async setProfile(profile: SessionProfile): Promise<ResolvedProfile> {
    await this.persistence.setSessionProfile(profile)
    if (profile !== 'elevated') await this.revokeGrant()
    return this.publish()
  }

  async setInvestigateScope(scope: InvestigateScope): Promise<ResolvedProfile> {
    await this.persistence.setInvestigateScope(scope)
    return this.publish()
  }

  /** Explicit user consent: issue a scoped, TTL-bounded grant and schedule its expiry. */
  async grantElevation(): Promise<ResolvedProfile> {
    const scope = await this.scope()
    const grant = createElevationGrant({ ...scope, now: this.now() })
    await this.persistence.setSessionProfile('elevated')
    await this.persistence.setElevationGrant(grant)
    this.scheduleExpiry(grant.expiresAt)
    return this.publish()
  }

  /** Drop the grant immediately; the profile stays `elevated` but inert. */
  async revokeElevation(): Promise<ResolvedProfile> {
    await this.revokeGrant()
    return this.publish()
  }

  /** The current grant, or null when none is stored. */
  grant(): ElevationGrant | null {
    return this.persistence.getElevationGrant() ?? null
  }

  /** Convenience for the approval gate: is `full` authorised right now? */
  async isElevated(): Promise<boolean> {
    const settings = await this.persistence.load()
    const grant = this.persistence.getElevationGrant()
    if (!grant) return false
    if (settings.profile !== 'elevated') return false
    return isGrantValid(grant, await this.scope(), this.now())
  }

  /**
   * The approval mode main will enforce for a run, independent of anything the
   * renderer sent. This is the P0-5 chokepoint.
   */
  async effectiveApprovalMode(): Promise<ResolvedProfile['approvalMode']> {
    return (await this.state()).approvalMode
  }

  private async revokeGrant(): Promise<void> {
    this.clearTimer()
    await this.persistence.setElevationGrant(null)
  }

  private scheduleExpiry(expiresAt: number): void {
    this.clearTimer()
    const delay = Math.max(0, expiresAt - this.now())
    this.timer = setTimeout(() => {
      this.timer = null
      void this.handleExpiry()
    }, delay)
    this.timer.unref?.()
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  /**
   * TTL reached: drop the grant in main so nothing downstream can resurrect it,
   * then tell every window the effective profile changed.
   */
  private async handleExpiry(): Promise<void> {
    if (this.disposed) return
    if (!this.persistence.getElevationGrant()) return
    await this.persistence.setElevationGrant(null)
    await this.publish()
  }

  private async publish(): Promise<ResolvedProfile> {
    const state = await this.state()
    this.onChanged(state)
    return state
  }
}
