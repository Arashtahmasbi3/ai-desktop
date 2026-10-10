/**
 * Post-deploy health checks (v2.3.2, B.2).
 *
 * After a deploy command (build / docker compose up) we verify the service is
 * actually up: its process is running, its port is listening and an HTTP
 * endpoint answers. Checks are declarative so they can be tested without SSH.
 */

import type { HealthCheckConfig, HealthCheckOutcome } from '@shared/vps'

export interface HealthCheckStep {
  name: string
  cmd: string
}

export interface ExecResult {
  ok: boolean
  stdout: string
  stderr?: string
  exitCode?: number
}

export type HealthExec = (command: string) => Promise<ExecResult>

/** POSIX single-quote so a config value can't break out of the command. */
function quote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/** Build the ordered list of checks implied by a project's health config. */
export function buildHealthChecks(config: HealthCheckConfig): HealthCheckStep[] {
  const checks: HealthCheckStep[] = []
  const processName = config.processName?.trim()
  if (processName) {
    checks.push({ name: 'process', cmd: `pgrep -f ${quote(processName)}` })
  }
  if (typeof config.port === 'number' && Number.isFinite(config.port)) {
    checks.push({ name: 'port', cmd: `ss -tlnp | grep ${quote(String(config.port))}` })
  }
  const endpoint =
    config.healthEndpoint?.trim() ||
    (typeof config.port === 'number' && Number.isFinite(config.port)
      ? `http://localhost:${config.port}/health`
      : '')
  if (endpoint) {
    checks.push({
      name: 'http',
      cmd: `curl -s -o /dev/null -w "%{http_code}" ${quote(endpoint)}`
    })
  }
  const customCommand = config.customCommand?.trim()
  if (customCommand) {
    checks.push({ name: 'custom', cmd: customCommand })
  }
  return checks
}

/**
 * Run every check in order, stopping at the first failure. HTTP checks require
 * a non-4xx/5xx status even though `curl` itself exits 0 on those.
 */
export async function runHealthCheck(
  exec: HealthExec,
  config: HealthCheckConfig
): Promise<HealthCheckOutcome> {
  const checks = buildHealthChecks(config)
  const ran: string[] = []

  for (const check of checks) {
    const result = await exec(check.cmd)
    ran.push(check.name)
    if (!result.ok) {
      return { ok: false, failed: check.name, output: outputOf(result), ran }
    }
    if (check.name === 'http') {
      const code = Number(result.stdout.trim())
      if (!Number.isFinite(code) || code < 200 || code >= 400) {
        return { ok: false, failed: check.name, output: `HTTP ${result.stdout.trim()}`, ran }
      }
    }
  }

  return { ok: true, ran }
}

function outputOf(result: ExecResult): string {
  return [result.stdout, result.stderr].filter((part) => part?.trim()).join('\n').trim()
}
