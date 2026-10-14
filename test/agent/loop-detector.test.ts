import { describe, it, expect } from 'vitest'
import { LoopDetector } from '@core/agent/loop-detector'

describe('LoopDetector', () => {
  it('does not warn below the repeated-action threshold', () => {
    const detector = new LoopDetector({ repeatedActionThreshold: 3, noProgressThreshold: 10 })
    const first = detector.observe({ signatures: ['write_file:{"a":1}'], productive: true })
    const second = detector.observe({ signatures: ['write_file:{"a":1}'], productive: false })
    const third = detector.observe({ signatures: ['write_file:{"a":1}'], productive: false })

    expect(first.warnings).toHaveLength(0)
    expect(second.warnings).toHaveLength(0)
    expect(third.warnings).toHaveLength(0)
    expect(detector.signatureCount('write_file:{"a":1}')).toBe(3)
  })

  it('warns when an action is repeated more than the threshold (count > 3)', () => {
    const detector = new LoopDetector({ repeatedActionThreshold: 3, noProgressThreshold: 100 })
    for (let i = 0; i < 3; i++) {
      detector.observe({ signatures: ['run_command:{}'], productive: false })
    }
    const result = detector.observe({ signatures: ['run_command:{}'], productive: false })

    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toMatchObject({ kind: 'repeated_action', count: 4 })
    expect(result.hint).toContain('[loop-detected]')
    expect(result.shouldAskUser).toBe(false)
  })

  it('only warns once per repeated signature', () => {
    const detector = new LoopDetector({ repeatedActionThreshold: 2, noProgressThreshold: 100 })
    const events = [1, 2, 3, 4, 5].map(() =>
      detector.observe({ signatures: ['read_file:{}'], productive: false })
    )
    const repeated = events.flatMap((event) => event.warnings)
    expect(repeated).toHaveLength(1)
  })

  it('resets the no-progress counter after a productive step', () => {
    const detector = new LoopDetector({ repeatedActionThreshold: 100, noProgressThreshold: 2 })
    detector.observe({ signatures: ['a'], productive: false })
    detector.observe({ signatures: ['b'], productive: false })
    expect(detector.noProgressSteps).toBe(2)

    detector.observe({ signatures: ['c'], productive: true })
    expect(detector.noProgressSteps).toBe(0)
  })

  it('asks the user after too many consecutive unproductive steps', () => {
    const detector = new LoopDetector({ repeatedActionThreshold: 100, noProgressThreshold: 2 })
    detector.observe({ signatures: ['a'], productive: false })
    detector.observe({ signatures: ['b'], productive: false })
    const result = detector.observe({ signatures: ['c'], productive: false })

    expect(result.shouldAskUser).toBe(true)
    expect(result.warnings.map((w) => w.kind)).toContain('no_progress')
  })

  it('reset() clears counts and state', () => {
    const detector = new LoopDetector({ repeatedActionThreshold: 1, noProgressThreshold: 2 })
    detector.observe({ signatures: ['a'], productive: false })
    detector.observe({ signatures: ['a'], productive: false })
    detector.reset()

    expect(detector.signatureCount('a')).toBe(0)
    expect(detector.noProgressSteps).toBe(0)
    expect(detector.observe({ signatures: ['a'], productive: false }).warnings).toHaveLength(0)
  })

  it('warns on the 3rd identical action and stops on the 5th (sliding window)', () => {
    const detector = new LoopDetector({ noProgressThreshold: 100, windowSize: 10 })
    const events = [1, 2, 3, 4, 5].map(() =>
      detector.observe({ signatures: ['run_command:{"command":"ls"}'], productive: false })
    )

    const third = events[2]
    expect(third.warnings.map((w) => w.kind)).toContain('repeated_action')
    expect(third.stop).toBe(false)

    const fourth = events[3]
    expect(fourth.stop).toBe(false)

    const fifth = events[4]
    expect(fifth.stop).toBe(true)
    expect(fifth.stopReason).toBe('repeated_action')
    expect(detector.isStopped).toBe(true)
  })

  it('keeps only the last N signatures in the sliding window', () => {
    const detector = new LoopDetector({ noProgressThreshold: 100, windowSize: 3, repeatedStopThreshold: 99 })
    for (const sig of ['a', 'b', 'c', 'd', 'e']) {
      detector.observe({ signatures: [sig], productive: false })
    }
    expect(detector.windowSize).toBe(3)
  })

  it('stops after 3 consecutive steps with failing actions', () => {
    const detector = new LoopDetector({
      repeatedActionThreshold: 100,
      noProgressThreshold: 100,
      failureThreshold: 3
    })
    const first = detector.observe({ signatures: ['a'], productive: false, failures: 1 })
    const second = detector.observe({ signatures: ['b'], productive: false, failures: 2 })
    const third = detector.observe({ signatures: ['c'], productive: false, failures: 1 })

    expect(first.stop).toBe(false)
    expect(second.stop).toBe(false)
    expect(third.stop).toBe(true)
    expect(third.stopReason).toBe('failure_streak')
    expect(third.warnings.map((w) => w.kind)).toContain('failure_streak')
  })

  it('clears the failure streak after a step with no failures', () => {
    const detector = new LoopDetector({
      repeatedActionThreshold: 100,
      noProgressThreshold: 100,
      failureThreshold: 3
    })
    detector.observe({ signatures: ['a'], productive: false, failures: 1 })
    detector.observe({ signatures: ['b'], productive: false, failures: 0 })
    const result = detector.observe({ signatures: ['c'], productive: false, failures: 1 })
    expect(result.stop).toBe(false)
  })

  it('a productive step with one failing action does NOT extend the streak (v2.8.0)', () => {
    // The regression behind "sometimes it still gets stuck in a loop and cannot
    // continue": `failures` counts every `!ok` observation, so red test → fix → red
    // test → fix scored as three consecutive failure steps and killed the run. The
    // policy's own doc says "steps whose actions ALL failed"; ordinary debugging
    // (and TDD) must not be mistaken for a stuck run.
    const detector = new LoopDetector({
      repeatedActionThreshold: 100,
      noProgressThreshold: 100,
      failureThreshold: 3
    })

    let stopped = false
    for (let step = 0; step < 6; step += 1) {
      // Each step writes a file successfully and then sees a red command. The
      // commands differ per step on purpose: repeating one identical command IS a
      // loop and is caught by the repeat detector, which is not what this covers.
      const result = detector.observe({
        signatures: [`write_file:{"path":"f${step}"}`, `run_command:{"command":"step ${step}"}`],
        productive: true,
        failures: 1
      })
      stopped = stopped || result.stop
    }

    expect(stopped).toBe(false)
    expect(detector.noProgressSteps).toBe(0)
  })

  it('still stops when every action in the step failed', () => {
    const detector = new LoopDetector({
      repeatedActionThreshold: 100,
      noProgressThreshold: 100,
      failureThreshold: 3
    })

    const first = detector.observe({ signatures: ['a'], productive: false, failures: 1 })
    const second = detector.observe({ signatures: ['b'], productive: false, failures: 1 })
    const third = detector.observe({ signatures: ['c'], productive: false, failures: 1 })

    expect(first.stop).toBe(false)
    expect(second.stop).toBe(false)
    expect(third.stop).toBe(true)
    expect(third.stopReason).toBe('failure_streak')
  })

  it('stops when the same reasoning repeats without a new action', () => {
    const detector = new LoopDetector({
      repeatedActionThreshold: 100,
      noProgressThreshold: 100,
      reasoningThreshold: 2
    })
    const first = detector.observe({
      signatures: ['read_file:{}'],
      productive: false,
      newAction: false,
      reasoningSignature: 'let me try reading the file'
    })
    const second = detector.observe({
      signatures: ['read_file:{}'],
      productive: false,
      newAction: false,
      reasoningSignature: 'let me try reading the file'
    })

    expect(first.stop).toBe(false)
    expect(second.stop).toBe(true)
    expect(second.stopReason).toBe('reasoning_loop')
  })

  it('does not flag a reasoning loop when a new action is taken', () => {
    const detector = new LoopDetector({
      repeatedActionThreshold: 100,
      noProgressThreshold: 100,
      reasoningThreshold: 2
    })
    detector.observe({
      signatures: ['a'],
      productive: true,
      newAction: true,
      reasoningSignature: 'same text'
    })
    const result = detector.observe({
      signatures: ['b'],
      productive: true,
      newAction: true,
      reasoningSignature: 'same text'
    })
    expect(result.stop).toBe(false)
  })
})

/**
 * B-5 — the step-level repeat counters must be windowed, not lifetime-scoped.
 * `this.window` used to be dead code while `this.counts` accumulated for the
 * whole run, so five legitimate re-reads of one file spread over a long run
 * stopped it, and `markProgress()` did nothing for this layer.
 */
describe('LoopDetector — windowed repeat counters (B-5)', () => {
  it('bounds the signature count by the window instead of the whole run', () => {
    const detector = new LoopDetector({
      noProgressThreshold: 100,
      windowSize: 3,
      repeatedStopThreshold: 99
    })
    for (let i = 0; i < 10; i++) detector.observe({ signatures: ['same'], productive: true })

    expect(detector.signatureCount('same')).toBe(3)
    expect(detector.windowSize).toBe(3)
  })

  it('does not stop on re-reads that have left the window', () => {
    const detector = new LoopDetector({ noProgressThreshold: 100, windowSize: 4 })
    let stopped = false
    for (let i = 0; i < 5; i++) {
      stopped = detector.observe({ signatures: ['read_file:app.log'], productive: true }).stop || stopped
      for (const filler of ['list_dir:src', 'grep:needle']) {
        stopped = detector.observe({ signatures: [filler], productive: true }).stop || stopped
      }
    }

    expect(stopped).toBe(false)
    expect(detector.isStopped).toBe(false)
    expect(detector.signatureCount('read_file:app.log')).toBeLessThanOrEqual(2)
  })

  it('keeps the step-level window when a successful action credits progress', () => {
    // `markProgress()` refreshes the *per-call* guard only: a successful action
    // that keeps repeating is still a loop, so the step-level counter stands.
    const detector = new LoopDetector({ noProgressThreshold: 100 })
    for (let i = 0; i < 5; i++) {
      detector.observe({ signatures: ['read_file:app.log'], productive: true })
      detector.markProgress()
    }

    expect(detector.signatureCount('read_file:app.log')).toBe(5)
    expect(detector.isStopped).toBe(true)
    expect(detector.stoppedReason).toBe('repeated_action')
  })

  it('still warns and stops when the same action repeats back-to-back', () => {
    const detector = new LoopDetector({ noProgressThreshold: 100 })
    const events = [1, 2, 3, 4, 5].map(() =>
      detector.observe({ signatures: ['read_file:app.log'], productive: false })
    )
    expect(events[2].warnings.map((warning) => warning.kind)).toContain('repeated_action')
    expect(events[4].stop).toBe(true)
    expect(events[4].stopReason).toBe('repeated_action')
  })
})
