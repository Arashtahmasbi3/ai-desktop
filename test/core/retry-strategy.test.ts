import { describe, it, expect } from 'vitest'
import { LoopDetector } from '@core/agent/loop-detector'

/**
 * v2.5.3 Fix 5 - retry strategy for blocked paths/commands.
 *
 * When policy (P0-2 containment, the deny list, the diagnostic read-only gate)
 * refuses a target, re-asking for the same target can only be refused again.
 * The detector remembers it and skips the retry with guidance, without stopping
 * the whole run and without penalising the tool as "broken".
 */
const PATH = '/etc/os-release'
const COMMAND = 'rm -rf /var/log'

describe('LoopDetector - blocked paths', () => {
  it('rejects the same path again after it was blocked', () => {
    const detector = new LoopDetector()
    detector.afterToolCall('remote_read_file', { ok: false, blocked: true }, { path: PATH })

    const decision = detector.beforeToolCall('remote_read_file', { path: PATH })
    expect(decision.allow).toBe(false)
    expect(decision.action).toBe('block')
    expect(decision.reason).toContain(PATH)
    expect(decision.reason).toMatch(/Diagnostic Mode/)
  })

  it('matches a blocked path regardless of surrounding whitespace/separators', () => {
    const detector = new LoopDetector()
    detector.afterToolCall('remote_read_file', { ok: false, blocked: true }, { path: '/var/log/' })

    expect(detector.beforeToolCall('remote_read_file', { path: '/var/log' }).allow).toBe(false)
  })
})

describe('LoopDetector - blocked commands', () => {
  it('rejects the same command again after it was blocked', () => {
    const detector = new LoopDetector()
    detector.afterToolCall('remote_shell', { ok: false, blocked: true }, { command: COMMAND })

    const decision = detector.beforeToolCall('remote_shell', { command: 'rm   -rf  /var/log' })
    expect(decision.allow).toBe(false)
    expect(decision.action).toBe('block')
    expect(decision.reason).toMatch(/alternative/i)
  })
})

describe('LoopDetector - retry strategy is scoped', () => {
  it('allows an alternative path', () => {
    const detector = new LoopDetector()
    detector.afterToolCall('remote_read_file', { ok: false, blocked: true }, { path: PATH })

    expect(detector.beforeToolCall('remote_read_file', { path: '/etc/hostname' }).allow).toBe(true)
  })

  it('does not affect calls that carry neither the blocked path nor command', () => {
    const detector = new LoopDetector()
    detector.afterToolCall('remote_read_file', { ok: false, blocked: true }, { path: PATH })

    expect(detector.beforeToolCall('remote_shell', { command: 'uname -a' }).allow).toBe(true)
    expect(detector.blockedCommandNames).toEqual([])
  })

  it('does not treat a policy block as a broken tool', () => {
    const detector = new LoopDetector()
    detector.afterToolCall('remote_read_file', { ok: false, blocked: true }, { path: '/a' })
    detector.afterToolCall('remote_read_file', { ok: false, blocked: true }, { path: '/b' })

    expect(detector.blockedToolNames).toEqual([])
    expect(detector.beforeToolCall('remote_read_file', { path: '/c' }).allow).toBe(true)
  })
})

describe('LoopDetector - blocked targets are cleared', () => {
  it('reset() forgets blocked paths and commands', () => {
    const detector = new LoopDetector()
    detector.afterToolCall('remote_read_file', { ok: false, blocked: true }, { path: PATH })
    detector.afterToolCall('remote_shell', { ok: false, blocked: true }, { command: COMMAND })

    detector.reset()

    expect(detector.blockedPathNames).toEqual([])
    expect(detector.blockedCommandNames).toEqual([])
    expect(detector.beforeToolCall('remote_read_file', { path: PATH }).allow).toBe(true)
    expect(detector.beforeToolCall('remote_shell', { command: COMMAND }).allow).toBe(true)
  })

  it('a fresh run (Continue) starts with no blocked targets', () => {
    const firstRun = new LoopDetector()
    firstRun.afterToolCall('remote_read_file', { ok: false, blocked: true }, { path: PATH })
    expect(firstRun.beforeToolCall('remote_read_file', { path: PATH }).allow).toBe(false)

    // The orchestrator builds a new detector per run(), so a user "Continue"
    // (a new run) reopens the path: containment will refuse it again if it is
    // still off-limits, but the block is not carried across runs.
    const nextRun = new LoopDetector()
    expect(nextRun.beforeToolCall('remote_read_file', { path: PATH }).allow).toBe(true)
  })
})
