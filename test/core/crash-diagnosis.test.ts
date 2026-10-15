import { describe, it, expect, vi } from 'vitest'
import type { AgentAction } from '@shared/agent'
import type { VpsExecResult } from '@shared/vps'
import {
  CRASH_PROBES,
  analyzeEvidence,
  buildCrashProbes,
  formatDiagnosis,
  runCrashDiagnosis,
  type DiagnosisEvidence
} from '@core/agent/crash-diagnosis'
import { CrashDiagnosisToolExecutor, DIAGNOSE_CRASH_TOOL } from '@core/tools/crash-diagnosis-tool'
import { createDiagnosticPolicy } from '@core/remote/diagnostic-policy'

function evidence(overrides: Partial<DiagnosisEvidence> & { probeId: string }): DiagnosisEvidence {
  return {
    description: overrides.probeId,
    command: overrides.probeId,
    output: '',
    exitCode: 0,
    ok: true,
    ...overrides
  }
}

function execResult(overrides: Partial<VpsExecResult> = {}): VpsExecResult {
  return { ok: true, stdout: '', stderr: '', exitCode: 0, ...overrides }
}

/**
 * Task 3.2 - structured crash diagnosis. Causes are derived from probe evidence,
 * and Diagnostic Mode gates any probe that touches a system path.
 */
describe('Task 3.2 - crash diagnosis', () => {
  it('1. detects a PM2 process error', () => {
    const diagnosis = analyzeEvidence([
      evidence({
        probeId: 'pm2-errors',
        output: 'Error: exception in server.js at line 12',
        exitCode: 0
      })
    ])
    expect(diagnosis.cause).toBe('pm2_process_error')
    expect(diagnosis.confidence).toBe('high')
  })

  it('2. detects an out-of-memory kill', () => {
    const diagnosis = analyzeEvidence([
      evidence({ probeId: 'pm2-errors', ok: false, exitCode: 1, output: '' }),
      evidence({ probeId: 'oom-events', output: 'Killed process 1234 (node)' })
    ])
    expect(diagnosis.cause).toBe('out_of_memory')
  })

  it('3. detects a nearly full disk', () => {
    const diagnosis = analyzeEvidence([
      evidence({
        probeId: 'disk',
        output: 'Filesystem      Size  Used Avail Use% Mounted on\n/dev/sda1        40G   38G 2.0G  95% /'
      })
    ])
    expect(diagnosis.cause).toBe('disk_full')
    expect(diagnosis.evidenceSummary).toContain('95%')
  })

  it('4. reports unknown when nothing is wrong', () => {
    const diagnosis = analyzeEvidence([
      evidence({ probeId: 'pm2-errors', output: '' }),
      evidence({ probeId: 'oom-events', ok: false, exitCode: 1 }),
      evidence({ probeId: 'disk', output: 'Filesystem Size Used Avail Use% Mounted on\n/dev/sda1 40G 15G 25G 40% /' }),
      evidence({ probeId: 'systemd-failed', output: '0 loaded units listed.' })
    ])
    expect(diagnosis.cause).toBe('unknown')
    expect(diagnosis.confidence).toBe('low')
  })

  it('5. skips system-path probes when Diagnostic Mode is off, runs them when on', async () => {
    const exec = vi.fn(async (command: string) =>
      execResult({ stdout: command.includes('syslog') ? 'boom' : '' })
    )

    const off = await runCrashDiagnosis({ exec, diagnostic: null })
    const syslogOff = off.evidence.find((entry) => entry.probeId === 'syslog-errors')
    expect(syslogOff?.skipped).toBe(true)
    expect(exec.mock.calls.some(([cmd]) => String(cmd).includes('/var/log/syslog'))).toBe(false)

    exec.mockClear()
    const on = await runCrashDiagnosis({ exec, diagnostic: createDiagnosticPolicy() })
    const syslogOn = on.evidence.find((entry) => entry.probeId === 'syslog-errors')
    expect(syslogOn?.skipped).toBeUndefined()
    expect(exec.mock.calls.some(([cmd]) => String(cmd).includes('/var/log/syslog'))).toBe(true)
  })
})

/** The tool wrapper: pinned server, read-only probes, model-facing report. */
describe('Task 3.2 - diagnose_crash tool', () => {
  const action = (overrides: Partial<AgentAction> = {}): AgentAction => ({
    id: 'a1',
    name: 'diagnose_crash',
    arguments: {},
    rawArguments: '{}',
    valid: true,
    signature: 'diagnose_crash:{}',
    ...overrides
  })

  it('runs the probes against the pinned server and formats a report', async () => {
    const exec = vi.fn(async (_server: string, command: string) =>
      command.startsWith('pm2 logs') || command.startsWith('grep')
        ? execResult({ stdout: 'Error: crash', exitCode: 0 })
        : execResult({ stdout: 'ok' })
    )
    const executor = new CrashDiagnosisToolExecutor(
      { exec, connectedServers: () => ['srv-1'], projectRoot: '/opt/app' },
      'srv-1'
    )

    const result = await executor.execute(action())
    expect(result.ok).toBe(true)
    expect(result.serverId).toBe('srv-1')
    expect(result.output).toContain('== Diagnosis ==')
    expect(result.output).toContain('pm2_process_error')
    // Every probe is a read-only command; the pinned server is always used.
    expect(exec.mock.calls.every(([server]) => server === 'srv-1')).toBe(true)
  })

  it('refuses a disconnected server', async () => {
    const executor = new CrashDiagnosisToolExecutor(
      { exec: vi.fn(), connectedServers: () => [], projectRoot: '/opt/app' },
      'srv-1'
    )
    const result = await executor.execute(action())
    expect(result.ok).toBe(false)
    expect(result.error).toContain('not connected')
  })

  it('substitutes the project root into the project probes', () => {
    const probes = buildCrashProbes('/opt/demo-project')
    const probe = probes.find((entry) => entry.id === 'recent-releases')
    expect(probe?.command).toContain("'/opt/demo-project'/releases/")
    expect(CRASH_PROBES.find((entry) => entry.id === 'recent-releases')?.command).toContain('{{ROOT}}')
  })

  it('quotes the project root so a space or quote cannot break the probe (B-18)', () => {
    const root = "/srv/my app/it's"
    const probes = buildCrashProbes(root)
    const list = probes.find((entry) => entry.id === 'project-root')
    const releases = probes.find((entry) => entry.id === 'recent-releases')

    // The root is POSIX single-quoted (with the `'\''` escape for the quote).
    expect(list?.command).toContain(`'/srv/my app/it'\\''s'/`)
    expect(releases?.command).toContain(`'/srv/my app/it'\\''s'/releases/`)
    // ...so the raw, shell-breaking form never reaches the command.
    expect(list?.command).not.toContain("/srv/my app/it's/")
    expect(list?.command).not.toContain('ls -la /srv')
  })

  it('formatDiagnosis includes evidence, cause and recommendations', () => {
    const text = formatDiagnosis({
      evidence: [evidence({ probeId: 'disk', description: 'Check disk', output: '95% /' })],
      diagnosis: analyzeEvidence([evidence({ probeId: 'disk', output: '95% /' })])
    })
    expect(text).toContain('== Evidence ==')
    expect(text).toContain('disk_full')
  })

  it('DIAGNOSE_CRASH_TOOL is the name the executor dispatches on', () => {
    expect(DIAGNOSE_CRASH_TOOL.name).toBe('diagnose_crash')
  })
})
