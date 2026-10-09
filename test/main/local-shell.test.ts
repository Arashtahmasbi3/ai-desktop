import { describe, it, expect } from 'vitest'
import { runLocalCommand } from '../../src/main/local-shell'

describe('runLocalCommand', () => {
  it('captures stdout and a zero exit code', async () => {
    const result = await runLocalCommand('node -e "process.stdout.write(\'hello\')"')
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('hello')
  })

  it('reports a non-zero exit code', async () => {
    const result = await runLocalCommand('node -e "process.exit(3)"')
    expect(result.exitCode).toBe(3)
  })

  it('caps a hung command with the timeout', async () => {
    const result = await runLocalCommand('node -e "setTimeout(() => {}, 5000)"', { timeoutMs: 300 })
    expect(result.exitCode).not.toBe(0)
  })
})
