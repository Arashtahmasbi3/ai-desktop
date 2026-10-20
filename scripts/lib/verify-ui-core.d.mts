/**
 * Types for `verify-ui-core.mjs`.
 *
 * The repo keeps these helpers as plain ESM `.mjs` plus a hand-written declaration (see `screenshot-core.d.mts`,
 * `release-core.d.mts`) so a script runs without a build step while the tests that exercise it stay strictly typed.
 * Without this file the pure checks would be `any`-typed, which is the one thing a test for "does the interface lie"
 * must not be.
 */

export interface StageRootOptions {
  /** Use this path instead of the platform default. */
  root?: string
  /** `process.platform` unless a test injects one. */
  platform?: string
  /** `os.tmpdir()` unless a test injects one. */
  tmpdir?: string
}

export interface StagePlanOptions extends StageRootOptions {
  repoRoot: string
}

export interface StagedCopy {
  from: string
  to: string
  note: string
}

export interface ProfileFile {
  path: string
  content: string
}

export interface StagePlan {
  root: string
  appDir: string
  electronDir: string
  electronExe: string
  profileDir: string
  appDataDir: string
  /** Environment overrides that redirect the app's own data directory at `profileDir`. */
  profileEnv: Record<string, string>
  copies: StagedCopy[]
  profileFiles: ProfileFile[]
}

export interface UiModeButton {
  pressed: string | null
  label: string
}

export interface UiModeFacts {
  exists: boolean
  buttons: UiModeButton[]
}

/** Every element that declares `data-connection`, with the test id (or tag name) that owns it. */
export interface ConnectionClaim {
  owner: string
  value: string
}

/** The small DOM probe the driver reads beside `document.body.innerText`. */
export interface DomQueries {
  statusBarCount?: number
  uiMode?: UiModeFacts
  /** `data-connection` on `[data-testid=status-item-workspace]`, if the element exists. */
  workspaceConnection?: string | null
  /** `data-connection` on the header dot, when it carries one at all. */
  headerConnection?: string | null
  connections?: ConnectionClaim[]
}

export interface Invariant {
  id: string
  title: string
  how: string
}

export interface InvariantResult {
  id: string
  title: string
  ok: boolean
  message: string
}

export interface DomReport {
  ok: boolean
  results: InvariantResult[]
  failures: InvariantResult[]
}

export declare const STAGE_DIR_NAME: string
export declare const APP_DATA_DIR_NAME: string
export declare const RUNTIME_DEPS: readonly string[]
export declare const LIVE_SHOT: string
export declare const DEFAULT_PORT: number
export declare const SELECTORS: Readonly<{
  statusBar: string
  uiMode: string
  workspaceItem: string
  connectionDot: string
  headerDot: string
}>
export declare const INVARIANTS: readonly Invariant[]

export declare function stagingRoot(options?: StageRootOptions): string
export declare function stagePlan(options: StagePlanOptions): StagePlan
export declare function electronArgs(plan: StagePlan, port?: number): string[]
export declare function launchEnv(
  plan: StagePlan,
  parent?: Readonly<Record<string, string | undefined>>
): Record<string, string | undefined>
export declare function debugUrl(port?: number): string
export declare function findRawUuids(text: string): string[]
export declare function checkDom(text: string, queries?: DomQueries): DomReport
