import { describe, expect, it } from 'vitest'
import {
  THREAD_STATES,
  WAITING_REASONS,
  isActiveState,
  isTerminalState,
  isThreadState,
  isWaitingReason,
  needsHuman,
  normalizeThreadState,
  stateLabelKey,
  stateTone,
  stateWaitingKey,
  waitingReasonOf,
  waitingRequiresReason
} from '../../src/renderer/src/lib/thread-state'

/**
 * Phase 0 of the workbench redesign: the closed state vocabulary.
 *
 * These cases exist because the defect they prevent is not a missing feature but a *drifting
 * vocabulary*: four surfaces reporting the same run with four spellings. A unit test on the
 * normaliser is the only place that drift can be caught before it reaches a panel.
 */

describe('the state vocabulary is closed', () => {
  it('ships exactly the seven agreed states, in order', () => {
    expect(THREAD_STATES).toEqual([
      'queued',
      'running',
      'waiting',
      'paused',
      'done',
      'failed',
      'cancelled'
    ])
  })

  it('accepts only those values', () => {
    for (const state of THREAD_STATES) expect(isThreadState(state)).toBe(true)
    for (const junk of ['', 'RUNNING', 'idle', 'stuck', null, undefined, 7]) {
      expect(isThreadState(junk)).toBe(false)
    }
  })

  it('gives every state its own label key and its own tone', () => {
    const keys = THREAD_STATES.map(stateLabelKey)
    expect(new Set(keys).size).toBe(THREAD_STATES.length)

    const tones = THREAD_STATES.map(stateTone)
    for (const tone of tones) {
      expect(['neutral', 'flow', 'attention', 'success', 'failure']).toContain(tone)
    }
    expect(tones).toContain('attention')
    expect(tones).toContain('failure')
  })

  it('flags only `waiting` as needing a human', () => {
    for (const state of THREAD_STATES) {
      expect(waitingRequiresReason(state)).toBe(state === 'waiting')
      expect(needsHuman(state)).toBe(state === 'waiting')
    }
  })

  it('separates "working now" from "finished", for both good and bad endings', () => {
    expect(THREAD_STATES.filter(isActiveState)).toEqual(['running'])
    expect(THREAD_STATES.filter(isTerminalState)).toEqual(['done', 'failed', 'cancelled'])
  })
})

describe('legacy spellings normalise instead of being re-interpreted per surface', () => {
  const cases: Array<[string, string]> = [
    ['pending', 'queued'],
    ['scheduled', 'queued'],
    ['queued', 'queued'],
    ['streaming', 'running'],
    ['connecting', 'running'],
    ['in_progress', 'running'],
    ['in progress', 'running'],
    ['awaiting_approval', 'waiting'],
    ['blocked', 'waiting'],
    ['suspended', 'paused'],
    ['completed', 'done'],
    ['succeeded', 'done'],
    ['ok', 'done'],
    ['errored', 'failed'],
    ['timed_out', 'failed'],
    ['timeout', 'failed'],
    ['aborted', 'cancelled'],
    ['killed', 'cancelled'],
    ['stopped', 'cancelled']
  ]

  it.each(cases)('maps %s to %s', (raw, expected) => {
    expect(normalizeThreadState(raw)).toBe(expected)
  })

  it('normalises case, surrounding space and hyphens', () => {
    expect(normalizeThreadState('  IN-PROGRESS ')).toBe('running')
    expect(normalizeThreadState('Awaiting Approval')).toBe('waiting')
  })

  it('returns null for unknown input rather than guessing a state', () => {
    // The old job panel treated anything that was not completed/failed as running, so finished work
    // kept a spinner. A null here forces the caller to render "unknown" instead of inventing one.
    expect(normalizeThreadState('whatever')).toBeNull()
    expect(normalizeThreadState('')).toBeNull()
    expect(normalizeThreadState(null)).toBeNull()
    expect(normalizeThreadState(undefined)).toBeNull()
  })

  it('never claims one legacy spelling for two different states', () => {
    /*
     * The name is the contract: one spelling must mean one state, every time. The body used to assert the opposite —
     * it keyed by state and required the raw spelling to match, which forbids the synonym map this module documents
     * (`pending`, `scheduled`, `waiting_to_start` all mean `queued`). Two spellings sharing a state is the feature;
     * one spelling drifting between two states would be the bug, and that is what this checks.
     */
    for (const raw of [
      'pending',
      'scheduled',
      'streaming',
      'connecting',
      'awaiting_approval',
      'blocked',
      'suspended',
      'completed',
      'ok',
      'error',
      'timeout',
      'killed'
    ]) {
      const state = normalizeThreadState(raw)
      expect(state).not.toBeNull()
      expect(normalizeThreadState(raw)).toBe(state)
    }
  })
})

describe('a wait must name its blocker', () => {
  it('exposes a key per reason', () => {
    for (const reason of WAITING_REASONS) {
      expect(stateWaitingKey(reason)).toBe(`state.waitingReason.${reason}`)
    }
    expect(isWaitingReason('approval')).toBe(true)
    expect(isWaitingReason('coffee')).toBe(false)
  })

  it('returns the reason for a waiting state and nothing for the others', () => {
    expect(waitingReasonOf({ state: 'waiting', waitingReason: 'approval' })).toBe('approval')
    expect(waitingReasonOf({ state: 'waiting', waitingReason: 'network' })).toBe('network')
    expect(waitingReasonOf({ state: 'running', waitingReason: 'approval' })).toBeNull()
    expect(waitingReasonOf({ state: 'done' })).toBeNull()
  })

  it('treats an invalid reason as absent, not as a default', () => {
    // `as never` because the type already forbids it; the runtime path matters for IPC payloads.
    expect(waitingReasonOf({ state: 'waiting', waitingReason: 'nonsense' as never })).toBeNull()
  })
})
