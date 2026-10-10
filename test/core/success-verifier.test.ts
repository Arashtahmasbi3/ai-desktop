import { describe, expect, it } from 'vitest'
import {
  VERIFICATION_WINDOW_MS,
  claimsSuccess,
  isVerificationTool,
  verifySuccess,
  type ToolCallRecord
} from '@core/agent/success-verifier'

const NOW = 1_000_000

const call = (toolName: string, exitCode: number, ageMs = 1_000): ToolCallRecord => ({
  toolName,
  exitCode,
  timestamp: NOW - ageMs
})

describe('verifySuccess', () => {
  it('allows a success claim backed by a recent passing test (scenario 1)', () => {
    const result = verifySuccess('انجام شد', [call('run_tests', 0)], NOW)
    expect(result.allowed).toBe(true)
  })

  it('blocks a success claim with no verification (scenario 2)', () => {
    const result = verifySuccess('done', [call('remote_write_file', 0)], NOW)
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('verification')
  })

  it('allows an error report with no verification needed (scenario 3)', () => {
    const result = verifySuccess('the command failed with an error', [], NOW)
    expect(result.allowed).toBe(true)
  })

  it('allows a neutral statement even with a passing tool call (scenario 4)', () => {
    const result = verifySuccess('I created the file', [call('remote_write_file', 0)], NOW)
    expect(result.allowed).toBe(true)
  })

  it('blocks a deploy claim without a health check (scenario 5)', () => {
    const result = verifySuccess('deployed to production', [call('remote_shell', 0)], NOW)
    expect(result.allowed).toBe(false)
  })

  it('ignores verification calls older than the window', () => {
    const stale = call('run_tests', 0, VERIFICATION_WINDOW_MS + 5_000)
    expect(verifySuccess('done', [stale], NOW).allowed).toBe(false)
  })

  it('ignores verification calls that failed', () => {
    expect(verifySuccess('done', [call('run_tests', 1)], NOW).allowed).toBe(false)
  })
})

describe('success helpers', () => {
  it('detects success markers in both languages', () => {
    expect(claimsSuccess('All done!')).toBe(true)
    expect(claimsSuccess('حل شد')).toBe(true)
    expect(claimsSuccess('still running')).toBe(false)
  })

  it('recognises verification tool names', () => {
    expect(isVerificationTool('run_tests')).toBe(true)
    expect(isVerificationTool('health_check')).toBe(true)
    expect(isVerificationTool('verify_deploy')).toBe(true)
    expect(isVerificationTool('remote_write_file')).toBe(false)
  })
})
