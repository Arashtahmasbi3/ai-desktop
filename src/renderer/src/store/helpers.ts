import type { StoreApi } from 'zustand'
import type { AppState } from './types'

const AUTOSAVE_INTERVAL_MS = 30_000

export function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `id-${Math.random().toString(36).slice(2)}`
}

export function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path
}

let autosaveTimer: ReturnType<typeof setInterval> | null = null

export function startAutosave(get: () => AppState): void {
  if (autosaveTimer || typeof setInterval !== 'function') return
  autosaveTimer = setInterval(() => {
    const state = get()
    if (state.messages.length > 0) void state.persistChat()
  }, AUTOSAVE_INTERVAL_MS)
}

/*
 * Every slice receives the same zustand set/get pair, so a slice is just a
 * typed view onto the one store instance created in `store.ts`.
 */
export type StoreSet = StoreApi<AppState>['setState']
export type StoreGet = StoreApi<AppState>['getState']
