/**
 * Environment health check (v2.3.3, C.1).
 *
 * Runs the probes in parallel over an injected `exec` and parses the output into
 * a structured report, so the AI (and the diagnostics panel) can see what is
 * installed before proposing an install. Parsers are exported for tests.
 */

import type {
  DiskHealth,
  HealthRecommendation,
  MemoryHealth,
  OsHealth,
  SystemHealth,
  ToolHealth
} from '@shared/system-health'
import type { WorkspaceExec } from './workspace-detect'

export const HEALTH_COMMANDS: Readonly<Record<string, string>> = {
  node: 'node --version 2>/dev/null',
  npm: 'npm --version 2>/dev/null',
  git: 'git --version 2>/dev/null',
  docker: 'docker --version 2>/dev/null',
  pm2: 'pm2 --version 2>/dev/null',
  disk: 'df -h / --output=size,used,avail,pcent 2>/dev/null',
  memory: 'free -h 2>/dev/null',
  os: 'uname -a 2>/dev/null'
}

const VERSION_RE = /(\d+\.\d+(?:\.\d+)?)/

/** Pull a version out of any `x --version` output. */
export function parseToolVersion(stdout: string, ok: boolean): ToolHealth {
  const text = stdout.trim()
  if (!ok || !text) return { installed: false }
  const match = text.match(VERSION_RE)
  return match ? { installed: true, version: match[1] } : { installed: true }
}

/** `df -h / --output=size,used,avail,pcent` → structured disk usage. */
export function parseDisk(stdout: string): DiskHealth {
  const lines = stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  const values = lines.length > 1 ? lines[lines.length - 1] : lines[0]
  const parts = (values ?? '').split(/\s+/)
  const percent = Number((parts[3] ?? '').replace('%', ''))
  return {
    total: parts[0] ?? '',
    used: parts[1] ?? '',
    free: parts[2] ?? '',
    percent: Number.isFinite(percent) ? percent : 0
  }
}

/** `free -h` → memory, preferring the `Mem:` row. */
export function parseMemory(stdout: string): MemoryHealth {
  const line = stdout
    .split('\n')
    .find((entry) => entry.trim().startsWith('Mem:'))
  const parts = (line ?? '').trim().split(/\s+/)
  return { total: parts[1] ?? '', used: parts[2] ?? '', free: parts[3] ?? '' }
}

/** `uname -a` → name + kernel release (best effort without a distro probe). */
export function parseOs(stdout: string): OsHealth {
  const parts = stdout.trim().split(/\s+/)
  return { name: parts[0] || 'unknown', version: parts[2] ?? '' }
}

export interface SystemHealthExecResult {
  ok: boolean
  stdout: string
}

/** Run all probes in parallel and assemble the report. */
export async function getSystemHealth(exec: WorkspaceExec): Promise<SystemHealth> {
  const names = Object.keys(HEALTH_COMMANDS) as Array<keyof typeof HEALTH_COMMANDS>
  const results = await Promise.all(
    names.map(async (name) => {
      try {
        const result = await exec(HEALTH_COMMANDS[name])
        return [name, result] as const
      } catch {
        return [name, { ok: false, stdout: '' }] as const
      }
    })
  )
  const byName = Object.fromEntries(results) as Record<string, SystemHealthExecResult>

  return {
    node: parseToolVersion(byName.node.stdout, byName.node.ok),
    npm: parseToolVersion(byName.npm.stdout, byName.npm.ok),
    git: parseToolVersion(byName.git.stdout, byName.git.ok),
    docker: parseToolVersion(byName.docker.stdout, byName.docker.ok),
    pm2: parseToolVersion(byName.pm2.stdout, byName.pm2.ok),
    disk: parseDisk(byName.disk.stdout),
    memory: parseMemory(byName.memory.stdout),
    os: parseOs(byName.os.stdout)
  }
}

export const INSTALLABLE_TOOLS: readonly string[] = ['node', 'git', 'docker', 'pm2']

/** Derive the "what's missing" list shown under the report. */
export function healthRecommendations(health: SystemHealth): HealthRecommendation[] {
  const recommendations: HealthRecommendation[] = []
  for (const tool of INSTALLABLE_TOOLS) {
    if (!health[tool as 'node'].installed) {
      recommendations.push({
        id: `missing-${tool}`,
        message: `${tool} is not installed`,
        installTool: tool
      })
    }
  }
  if (health.disk.percent >= 90) {
    recommendations.push({
      id: 'disk-critical',
      message: `Disk is ${health.disk.percent}% full`
    })
  } else if (health.disk.percent >= 80) {
    recommendations.push({
      id: 'disk-warning',
      message: `Disk is ${health.disk.percent}% full`
    })
  }
  return recommendations
}
