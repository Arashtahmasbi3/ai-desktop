/**
 * Types for `scripts/lib/release-core.mjs` (O4-3). The implementation is plain
 * ESM JavaScript because a release script must run under bare `node`, so this
 * declaration file is what lets `test/main/release-script.test.ts` import it
 * under `strict` TypeScript. Keep the two in lockstep: a test asserts that every
 * export named here exists at runtime.
 */

export type BumpKind = 'major' | 'minor' | 'patch'

export const RELEASE_BRANCH: string
export const PRODUCT_NAME: string
export const RELEASE_DIR: string
export const SUMS_FILE: string
export const LOCK_FILE: string
export const MANIFEST_FILE: string
export const CHANGELOG_FILE: string

export class ReleaseError extends Error {
  readonly code: string
  constructor(message: string, code?: string)
}

export function usage(): string

export interface ReleaseArgs {
  readonly help: boolean
  readonly dryRun: boolean
  readonly commit: boolean
  readonly push: boolean
  readonly version: string | null
}

export function parseArgs(argv: readonly string[]): ReleaseArgs

export interface ParsedVersion {
  readonly major: number
  readonly minor: number
  readonly patch: number
  readonly version: string
}

export function parseVersion(raw: string): ParsedVersion | null

export function classifyBump(currentRaw: string, nextRaw: string): BumpKind | null

export type TargetValidation =
  | { readonly ok: true; readonly version: string; readonly current: string; readonly bump: BumpKind }
  | { readonly ok: false; readonly code: string; readonly message: string }

export function validateTarget(raw: string, currentRaw: string): TargetValidation

export function expectedArtifacts(version: string, productName?: string): readonly [string, string]

export interface SumsEntry {
  readonly sha256: string
  readonly name: string
}

export function parseSums(text: string): SumsEntry[]

export function artifactsForVersionInSums(sumsText: string, version: string): string[]

export interface PreflightSnapshot {
  readonly branch: string
  readonly dirtyFiles: readonly string[]
  readonly currentVersion: string
  readonly targetVersion: string
  readonly bump: BumpKind | null
  readonly tagExists: boolean
  readonly changelogHasTarget: boolean
  readonly sumsText: string
  readonly existingArtifactNames?: readonly string[]
}

export interface ReleaseBlocker {
  readonly code: string
  readonly message: string
}

export interface PreflightResult {
  readonly blockers: ReleaseBlocker[]
  readonly warnings: string[]
}

export function checkPreflight(snapshot: PreflightSnapshot): PreflightResult

export interface PlanStep {
  readonly id: string
  readonly title: string
  readonly detail: string
}

export interface PlanOptions {
  readonly currentVersion: string
  readonly targetVersion: string
  readonly bump: BumpKind
  readonly commit: boolean
  readonly push: boolean
}

export function buildPlan(options: PlanOptions): PlanStep[]

export interface FormatPlanOptions extends PlanOptions {
  readonly steps: readonly PlanStep[]
  readonly dryRun: boolean
}

export function formatPlan(options: FormatPlanOptions): string

export function sha256SumsContent(entries: readonly { readonly name: string; readonly sha256: string }[]): string

export function isPathInside(parent: string, candidate: string): boolean

export interface BuildDirectoryInput {
  readonly buildDir: string
  readonly repoRoot: string
  readonly protectedDirs?: readonly string[]
}

export function checkBuildDirectory(input: BuildDirectoryInput): { readonly ok: boolean; readonly problems: string[] }
