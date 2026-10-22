/**
 * Types for `screenshot-core.mjs`.
 *
 * The repo keeps its release helpers as plain ESM `.mjs` (`release-core.mjs` + `.d.mts`) so a script can run without a
 * build step; this follows the same shape. Without this file the pure screenshot tests are `any`-typed, which is the
 * one thing a test for a comparison function must not be.
 */
export interface Shot {
  name: string
  route: string
  note: string
}

export interface Target {
  type?: string
  url?: string
  webSocketDebuggerUrl?: string
}

export interface ShotSize {
  width: number
  height: number
}

export interface ShotFacts extends ShotSize {
  bytes: number
}

export type CompareStatus = 'ok' | 'missing-baseline' | 'missing-current' | 'size-changed' | 'empty' | 'drift'

export interface CompareResult {
  status: CompareStatus
  detail?: string
  drift?: number
  /** current width divided by baseline width; 1 when the sizes match. */
  scale?: number
  /** how far the aspect ratio moved, when status is `size-changed`. */
  aspectDrift?: number
}

export interface ShotResult {
  theme: string
  name: string
  status: CompareStatus | 'ok'
  detail?: string
}

export interface Summary {
  total: number
  changed: ShotResult[]
  missing: ShotResult[]
  ok: boolean
  line: string
}

export declare const SHOTS: readonly Shot[]
export declare const THEMES: readonly string[]
export declare function themeScript(theme: string): string
export declare function appTarget(targets: unknown): Target | undefined
export declare function compareShot(
  baseline: ShotFacts | null | undefined,
  current: ShotFacts | null | undefined,
  options?: { tolerance?: number }
): CompareResult
export declare function pngSize(buffer: Buffer): ShotSize | undefined
export declare function shotPath(theme: string, name: string): string
export declare function summarize(results: readonly ShotResult[]): Summary
