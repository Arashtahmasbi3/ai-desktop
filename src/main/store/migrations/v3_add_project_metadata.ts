/**
 * Settings schema v2 → v3: per-project metadata (v2.3.2, C.1).
 *
 * The pure backfill lives in `@shared/project-metadata` so the core persistence
 * layer (which runs the actual migration on load) can use it without importing
 * from `main`. This module is the named, versioned step: it records the
 * from/to versions and re-exports the transform so the migration path is
 * discoverable and independently testable.
 */

import {
  applyProjectMetadataDefaults,
  type ProjectMetadataInput
} from '@shared/project-metadata'

export const V3_ADD_PROJECT_METADATA = { from: 2, to: 3 } as const

/**
 * Apply v3 defaults (`updatedAt`, `environment`, `auditLogPath`) to one project
 * record. Idempotent and non-destructive — see
 * {@link applyProjectMetadataDefaults}.
 */
export function migrateProjectToV3(
  project: ProjectMetadataInput,
  now: number
): ProjectMetadataInput {
  return applyProjectMetadataDefaults(project, now)
}
