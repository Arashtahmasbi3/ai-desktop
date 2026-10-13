import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { ChildProcessRunner } from '@core/sandbox/command-runner'
import { resolveSandboxShell } from '@core/sandbox/shell'

const runner = new ChildProcessRunner()
// v2.6.5: the runner is shell-agnostic, so the test must use the same shell the
// sandbox resolves for this platform instead of hardcoding `/bin/sh` (which does
// not exist on Windows and made five tests fail there).
const shell = resolveSandboxShell(process.platform, process.env, existsSync)
const sh = shell.args

describe('ChildProcessRunner', () => {
  it('captures stdout and a zero exit code', async () => {
    const result = await runner.run(shell.file, sh('echo hello'))
    expect(result.exitCode).toBe(0)
    expect(result.stdout.trim()).toBe('hello')
    expect(result.timedOut).toBe(false)
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('captures stderr and propagates the exit code', async () => {
    const result = await runner.run(shell.file, sh('echo oops 1>&2; exit 3'))
    expect(result.exitCode).toBe(3)
    expect(result.stderr.trim()).toBe('oops')
  })

  it('kills a command that exceeds the timeout', async () => {
    const result = await runner.run(shell.file, sh('sleep 5'), { timeoutMs: 150 })
    expect(result.timedOut).toBe(true)
    expect(result.durationMs).toBeLessThan(4000)
  })

  it('feeds stdin to the process', async () => {
    const result = await runner.run(shell.file, sh('cat'), { stdin: 'piped-input' })
    expect(result.stdout).toBe('piped-input')
  })

  it('reports a spawn failure for a missing binary', async () => {
    await expect(runner.run('/nonexistent/binary', [])).rejects.toThrow()
  })

  it('truncates output beyond maxOutputBytes', async () => {
    const result = await runner.run(shell.file, sh('yes x | head -c 5000'), {
      maxOutputBytes: 100
    })
    expect(result.stdout.length).toBeLessThan(200)
  })
})
