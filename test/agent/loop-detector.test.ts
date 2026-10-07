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
})
