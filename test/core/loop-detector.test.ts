import { describe, it, expect } from 'vitest'
import { LoopDetector } from '@core/agent/loop-detector'

/**
 * Sprint v2.3.1 — Task A.1: fuzzy per-tool-call loop detection.
 * Scenario 8 is the regression that the old signature hash missed: the same
 * tool name with *different* arguments must still be caught.
 */
describe('LoopDetector — per-tool-call guard', () => {
  const call = (detector: LoopDetector, name: string, args: unknown = {}) => {
    const decision = detector.beforeToolCall(name, args)
    return decision
  }

  it('1. warns on the 3rd call of the same tool name', () => {
    const detector = new LoopDetector()
    const first = call(detector, 'remote_shell', { command: 'ls' })
    const second = call(detector, 'remote_shell', { command: 'ls' })
    const third = call(detector, 'remote_shell', { command: 'ls' })

    expect(first.action).toBeUndefined()
    expect(second.action).toBeUndefined()
    expect(third.action).toBe('warn')
    expect(third.allow).toBe(true)
    expect(third.count).toBe(3)
    expect(third.message).toContain('هشدار حلقه')
    expect(detector.isStopped).toBe(false)
  })

  it('2. stops on the 5th call of the same tool name', () => {
    const detector = new LoopDetector()
    const decisions = [1, 2, 3, 4, 5].map(() => call(detector, 'remote_shell'))

    expect(decisions[4].allow).toBe(false)
    expect(decisions[4].action).toBe('stop')
    expect(decisions[4].count).toBe(5)
    expect(decisions[4].message).toContain('5 بار تلاش تکراری') // 5 repeats
    expect(decisions[4].message).toContain('remote_shell')
    expect(detector.isStopped).toBe(true)
    expect(detector.stoppedReason).toBe('repeated_action')
  })

  it('3. stops after 3 consecutive failing tool calls', () => {
    const detector = new LoopDetector()
    for (let i = 0; i < 3; i++) {
      const decision = call(detector, `tool_${i}`)
      expect(decision.allow).toBe(true)
      detector.afterToolCall(`tool_${i}`, { ok: false })
    }

    expect(detector.isStopped).toBe(true)
    expect(detector.stoppedReason).toBe('failure_streak')
    // The next call is refused and explains the failure streak.
    const blocked = call(detector, 'tool_4')
    expect(blocked.allow).toBe(false)
    expect(blocked.action).toBe('stop')
  })

  it('4. allows 5 different tools with no repetition', () => {
    const detector = new LoopDetector()
    const names = ['read_file', 'write_file', 'list_dir', 'bash', 'git_status']
    for (const name of names) {
      const decision = call(detector, name)
      expect(decision.allow).toBe(true)
      expect(decision.action).toBeUndefined()
      detector.afterToolCall(name, { ok: true })
    }
    expect(detector.isStopped).toBe(false)
  })

  it('5. markProgress() resets the fuzzy window mid-loop', () => {
    const detector = new LoopDetector()
    for (let i = 0; i < 4; i++) call(detector, 'remote_shell')
    expect(detector.isStopped).toBe(false)

    detector.markProgress()

    const afterProgress = call(detector, 'remote_shell')
    expect(afterProgress.allow).toBe(true)
    expect(afterProgress.count).toBe(1)
    expect(detector.isStopped).toBe(false)
  })

  it('6. stops when 2 minutes pass without progress', () => {
    let now = 1_000_000
    const detector = new LoopDetector({}, { now: () => now })

    expect(call(detector, 'read_file').allow).toBe(true)

    now += 121_000 // > 120s without markProgress()
    const timedOut = call(detector, 'list_dir')
    expect(timedOut.allow).toBe(false)
    expect(timedOut.action).toBe('stop')
    expect(timedOut.reason).toBe('turn_timeout')
  })

  it('7. escape hatch: reset() clears a stop and allows again', () => {
    const detector = new LoopDetector()
    for (let i = 0; i < 5; i++) call(detector, 'remote_shell')
    expect(detector.isStopped).toBe(true)

    detector.reset() // "ادامه بده"

    const resumed = call(detector, 'remote_shell')
    expect(resumed.allow).toBe(true)
    expect(resumed.action).toBeUndefined()
    expect(detector.isStopped).toBe(false)
  })

  it('8. different arguments, same tool name — NOT a loop (call identity)', () => {
    const detector = new LoopDetector()
    const first = call(detector, 'remote_shell', { command: 'ls -la' })
    const second = call(detector, 'remote_shell', { command: 'pwd' })
    const third = call(detector, 'remote_shell', { command: 'whoami' })

    expect(first.action).toBeUndefined()
    expect(second.action).toBeUndefined()
    expect(third.action).toBeUndefined()
    expect(third.allow).toBe(true)
    expect(third.count).toBe(1)
    expect(detector.isStopped).toBe(false)
    // And the exact-hash layer kept all three distinct.
    expect(detector.toolCallHistory).toHaveLength(0) // nothing executed yet
  })

  it('9. a long script of distinct shell commands never stops', () => {
    const detector = new LoopDetector()
    const commands = ['pwd', 'ls', 'cat package.json', 'git status', 'npm test', 'whoami']
    for (const command of commands) {
      const decision = call(detector, 'remote_shell', { command })
      expect(decision.allow).toBe(true)
      expect(decision.action).toBeUndefined()
      detector.afterToolCall('remote_shell', { ok: true })
    }
    expect(detector.isStopped).toBe(false)
  })

  it('10. the same command still warns and stops (genuine loop)', () => {
    const detector = new LoopDetector()
    const decisions = [1, 2, 3, 4, 5].map(() =>
      call(detector, 'remote_shell', { command: 'git status' })
    )
    expect(decisions[2].action).toBe('warn')
    expect(decisions[4].action).toBe('stop')
    expect(decisions[4].count).toBe(5)
  })

  it('11. normalises insignificant whitespace in commands', () => {
    const detector = new LoopDetector()
    call(detector, 'run_command', { command: 'git status' })
    call(detector, 'run_command', { command: 'git   status  ' })
    const third = call(detector, 'run_command', { command: ' git  status' })

    expect(third.action).toBe('warn')
    expect(third.count).toBe(3)
  })

  it('12. keys filesystem tools by normalised path', () => {
    const detector = new LoopDetector()
    call(detector, 'read_file', { path: 'src/app.ts' })
    call(detector, 'read_file', { path: './src/app.ts/' })
    const third = call(detector, 'read_file', { path: 'src/app.ts' })

    expect(third.action).toBe('warn')
    expect(third.count).toBe(3)

    // A different path is a different call identity.
    const other = call(detector, 'read_file', { path: 'src/other.ts' })
    expect(other.action).toBeUndefined()
    expect(other.count).toBe(1)
  })

  it('13. falls back to the full arguments for unclassified tools', () => {
    const detector = new LoopDetector()
    call(detector, 'custom_tool', { a: 1 })
    call(detector, 'custom_tool', { a: 2 })
    const same = call(detector, 'custom_tool', { a: 1 })
    expect(same.count).toBe(2)
    expect(same.action).toBeUndefined()

    const third = call(detector, 'custom_tool', { a: 1 })
    expect(third.count).toBe(3)
    expect(third.action).toBe('warn')
  })

  it('records recent tool calls with timestamps for the STOP summary', () => {
    const detector = new LoopDetector()
    detector.afterToolCall('write_file', { ok: true })
    detector.afterToolCall('remote_shell', { ok: false })
    detector.afterToolCall('read_file', { ok: true })

    const history = detector.toolCallHistory
    expect(history.map((c) => c.toolName)).toEqual(['write_file', 'remote_shell', 'read_file'])
    expect(history.map((c) => c.ok)).toEqual([true, false, true])
    expect(history.every((c) => typeof c.at === 'number')).toBe(true)
  })

  it('a successful call clears the failure streak', () => {
    const detector = new LoopDetector()
    call(detector, 'a')
    detector.afterToolCall('a', { ok: false })
    call(detector, 'b')
    detector.afterToolCall('b', { ok: false })
    call(detector, 'c')
    detector.afterToolCall('c', { ok: true }) // streak reset

    call(detector, 'd')
    detector.afterToolCall('d', { ok: false })
    expect(detector.isStopped).toBe(false)
  })
})

/**
 * Sprint v2.3.3 — Task A.3: a call that fails twice is taken out of rotation so the
 * model tries something else instead of retrying it.
 *
 * v2.8.0: the block is keyed on the *call* (tool + arguments), not the tool. Keying
 * it on the tool name meant two red commands blacklisted `run_command` for the rest
 * of the run, and because a blocked call never executes it could never succeed — so
 * the block could never be lifted and the run wedged. Reported by the user as
 * "sometimes it still gets stuck in a loop and cannot continue".
 */
describe('LoopDetector — per-call failure blocking (A.3)', () => {
  it('1. blocks the exact call that failed twice', () => {
    const detector = new LoopDetector()
    detector.beforeToolCall('remote_shell', { command: 'git status' })
    detector.afterToolCall('remote_shell', { ok: false }, { command: 'git status' })
    detector.beforeToolCall('remote_shell', { command: 'git status' })
    detector.afterToolCall('remote_shell', { ok: false }, { command: 'git status' })

    expect(detector.blockedToolNames).toContain('remote_shell')
    const decision = detector.beforeToolCall('remote_shell', { command: 'git status' })
    expect(decision.allow).toBe(false)
    expect(decision.action).toBe('block')
    expect(decision.reason).toMatch(/failed 2 times/)
  })

  it('1b. a DIFFERENT command from the same tool is still allowed', () => {
    // The regression: two failing commands used to blacklist `remote_shell`
    // entirely, which is how a normal debugging loop got wedged.
    const detector = new LoopDetector()
    detector.afterToolCall('remote_shell', { ok: false }, { command: 'git status' })
    detector.afterToolCall('remote_shell', { ok: false }, { command: 'git log' })

    const other = detector.beforeToolCall('remote_shell', { command: 'npm run build' })
    expect(other.allow).toBe(true)
  })

  it('1c. real progress lifts the block, so a run cannot wedge permanently', () => {
    const detector = new LoopDetector()
    detector.afterToolCall('remote_shell', { ok: false }, { command: 'git status' })
    detector.afterToolCall('remote_shell', { ok: false }, { command: 'git status' })
    expect(detector.beforeToolCall('remote_shell', { command: 'git status' }).action).toBe('block')

    // The model writes a file successfully — that is progress, and the tool is
    // usable again. Without this the block was permanent for the whole run.
    detector.markProgress()
    expect(detector.beforeToolCall('remote_shell', { command: 'git status' }).allow).toBe(true)
  })

  it('2. lets the model fall back to another tool (read_file)', () => {
    const detector = new LoopDetector()
    detector.afterToolCall('remote_shell', { ok: false })
    detector.afterToolCall('remote_shell', { ok: false })

    expect(detector.beforeToolCall('remote_shell', {}).action).toBe('block')
    const fallback = detector.beforeToolCall('remote_read_file', { path: 'a.txt' })
    expect(fallback.allow).toBe(true)
    expect(fallback.action).toBeUndefined()
  })

  it('3. does not block unrelated tools', () => {
    const detector = new LoopDetector()
    detector.afterToolCall('remote_shell', { ok: false })
    detector.afterToolCall('remote_shell', { ok: false })

    expect(detector.beforeToolCall('remote_list_dir', { path: '.' }).allow).toBe(true)
    expect(detector.blockedToolNames).toEqual(['remote_shell'])
  })

  it('4. reset() clears the blocked set', () => {
    const detector = new LoopDetector()
    detector.afterToolCall('remote_shell', { ok: false })
    detector.afterToolCall('remote_shell', { ok: false })
    expect(detector.beforeToolCall('remote_shell', {}).allow).toBe(false)

    detector.reset()

    expect(detector.blockedToolNames).toEqual([])
    expect(detector.beforeToolCall('remote_shell', {}).allow).toBe(true)
  })

  it('5. a later success un-blocks the tool', () => {
    const detector = new LoopDetector()
    detector.afterToolCall('remote_shell', { ok: false })
    detector.afterToolCall('remote_shell', { ok: false })
    expect(detector.blockedToolNames).toContain('remote_shell')

    detector.afterToolCall('remote_shell', { ok: true })
    expect(detector.blockedToolNames).not.toContain('remote_shell')
    expect(detector.beforeToolCall('remote_shell', {}).allow).toBe(true)
  })
})
