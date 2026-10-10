import { describe, it, expect } from 'vitest'
import { buildHealthChecks, runHealthCheck, type ExecResult } from '@core/remote/health-check'

function execOk(stdout = ''): ExecResult {
  return { ok: true, stdout, stderr: '', exitCode: 0 }
}

function execFail(stderr = 'boom'): ExecResult {
  return { ok: false, stdout: '', stderr, exitCode: 1 }
}

describe('buildHealthChecks', () => {
  it('returns no checks for an empty config', () => {
    expect(buildHealthChecks({})).toEqual([])
  })

  it('builds process, port, http and custom checks in order', () => {
    const checks = buildHealthChecks({
      processName: 'my app',
      port: 3000,
      customCommand: 'test -f /tmp/up'
    })
    expect(checks.map((c) => c.name)).toEqual(['process', 'port', 'http', 'custom'])
    expect(checks[0].cmd).toBe("pgrep -f 'my app'")
    expect(checks[1].cmd).toBe("ss -tlnp | grep '3000'")
    expect(checks[2].cmd).toBe('curl -s -o /dev/null -w "%{http_code}" \'http://localhost:3000/health\'')
  })

  it('uses a custom health endpoint when given', () => {
    const checks = buildHealthChecks({ healthEndpoint: 'https://x.test/ready' })
    expect(checks).toHaveLength(1)
    expect(checks[0].cmd).toBe('curl -s -o /dev/null -w "%{http_code}" \'https://x.test/ready\'')
  })
})

describe('runHealthCheck', () => {
  it('passes when every check exits 0 and http returns 200', async () => {
    const commands: string[] = []
    const outcome = await runHealthCheck(async (cmd) => {
      commands.push(cmd)
      return cmd.includes('curl') ? execOk('200') : execOk('ok')
    }, { processName: 'api', port: 8080 })

    expect(outcome).toEqual({ ok: true, ran: ['process', 'port', 'http'] })
    expect(commands).toHaveLength(3)
  })

  it('stops at the first failing check and reports its output', async () => {
    const ran: string[] = []
    const outcome = await runHealthCheck(async (cmd) => {
      ran.push(cmd)
      return cmd.startsWith('ss') ? execFail('not listening') : execOk()
    }, { processName: 'api', port: 8080 })

    expect(outcome.ok).toBe(false)
    expect(outcome.failed).toBe('port')
    expect(outcome.output).toContain('not listening')
    expect(outcome.ran).toEqual(['process', 'port'])
    expect(ran).toHaveLength(2)
  })

  it('fails when the http check returns a 5xx even though curl exits 0', async () => {
    const outcome = await runHealthCheck(async () => execOk('500'), {
      healthEndpoint: 'http://localhost:3000/health'
    })
    expect(outcome).toEqual({ ok: false, failed: 'http', output: 'HTTP 500', ran: ['http'] })
  })

  it('fails a custom command that exits non-zero', async () => {
    const outcome = await runHealthCheck(async () => execFail('missing marker'), {
      customCommand: 'test -f /tmp/up'
    })
    expect(outcome.ok).toBe(false)
    expect(outcome.failed).toBe('custom')
    expect(outcome.output).toBe('missing marker')
  })
})
