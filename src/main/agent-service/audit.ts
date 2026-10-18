import type { Persistence } from '@core/agent/persistence'
import { resolveUserDataDir } from '@core/agent/persistence'
import { redactValue } from '@core/agent/redact'
import { AuditTrail, auditFileFor, type AuditVerifyResult } from '@core/agent/audit-trail'
import type { ProjectRecord } from '@shared/ui'

/**
 * Tamper-evident audit trails, one per project file (F0-4).
 *
 * Split out of `agent-service.ts`. One trail per file is cached here and reused, so
 * appends continue the same hash chain across runs and across restarts of the app.
 */

export class AuditTrails {
  private readonly persistence: Persistence
  private readonly userDataDir?: string
  private readonly audits = new Map<string, AuditTrail>()

  constructor(persistence: Persistence, userDataDir?: string) {
    this.persistence = persistence
    if (userDataDir) this.userDataDir = userDataDir
  }

  /** One trail per project file, reused so appends continue the same chain. */
  trailFor(project: ProjectRecord): AuditTrail {
    const file = auditFileFor(project, this.userDataDir ?? resolveUserDataDir({ appName: 'AI Desktop' }))
    const cached = this.audits.get(file)
    if (cached) return cached
    const trail = new AuditTrail({ file, redact: (line) => redactValue(line) })
    this.audits.set(file, trail)
    return trail
  }

  /** Absolute path of the active project's audit file, when there is one. */
  auditPath(): string | null {
    const project = this.persistence.getActiveProject()
    return project ? this.trailFor(project).path : null
  }

  /**
   * v2.6.2 T3.3: recompute the active project's audit hash chain. Reported to
   * Settings → Verify audit; also the hook tamper detection will use.
   */
  async verify(): Promise<AuditVerifyResult | null> {
    const project = this.persistence.getActiveProject()
    if (!project) return null
    return this.trailFor(project).verify()
  }
}