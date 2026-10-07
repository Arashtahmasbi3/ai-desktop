import { describe, it, expect } from 'vitest'
import { ChildProcessRunner } from '@core/sandbox/command-runner'

const runner = new ChildProcessRunner()
const sh = (command: string): string[] => ['-c', command]

describe('ChildProcessRunner', () => {
  it('captures stdout and a zero exit code', async () => {
    const result = await runner.run('/bin/sh', sh('echo hello'))
    expect(result.exitCode).toBe(0)
    expect(result.stdout.trim()).toBe('hello')
    expect(result.timedOut).toBe(false)
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('captures stderr and propagates the exit code', async () => {
    const result = await runner.run('/bin/sh', sh('echo oops 1>&2; exit 3'))
    expect(result.exitCode).toBe(3)
    expect(result.stderr.trim()).toBe('oops')
  })

  it('kills a command that exceeds the timeout', async () => {
    const result = await runner.run('/bin/sh', sh('sleep 5'), { timeoutMs: 150 })
    expect(result.timedOut).toBe(true)
    expect(result.durationMs).toBeLessThan(4000)
  })

  it('feeds stdin to the process', async () => {
    const result = await runner.run('/bin/sh', sh('cat'), { stdin: 'piped-input' })
    expect(result.stdout).toBe('piped-input')
  })

  it('reports a spawn failure for a missing binary', async () => {
    await expect(runner.run('/nonexistent/binary', [])).rejects.toThrow()
  })

  it('truncates output beyond maxOutputBytes', async () => {
    const result = await runner.run('/bin/sh', sh('yes x | head -c 5000'), {
      maxOutputBytes: 100
    })
    expect(result.stdout.length).toBeLessThan(200)
  })
})
