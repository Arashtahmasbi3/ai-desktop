/**
 * Structured crash diagnosis (v2.5.6, Task 3.2).
 *
 * The agent used to guess at a crash with ad-hoc shell commands, which was slow
 * and often looped (a blocked chained command would be retried verbatim). This
 * module replaces the guesswork with a fixed, ordered set of read-only probes
 * whose output is analysed into a single probable cause.
 *
 * Everything here is pure over an injected `exec`, so it can be unit-tested
 * without SSH or an LLM. Probes that need a system path are skipped unless
 * Diagnostic Mode exposes it (the same read-only widening as v2.5.3).
 */
import { isDiagnosticAllowed, type DiagnosticPolicy } from '@core/remote/diagnostic-policy'

export type DiagnosisCategory = 'process' | 'logs' | 'resources' | 'network' | 'config'

export interface DiagnosisProbe {
  id: string
  description: string
  command: string
  category: DiagnosisCategory
  timeout: number
}

/** The read-only probes run, in order, for every diagnosis. */
export const CRASH_PROBES: DiagnosisProbe[] = [
  // Process managers
  { id: 'pm2-list', description: 'Check PM2 processes', command: 'pm2 list 2>&1 | head -50', category: 'process', timeout: 10000 },
  { id: 'pm2-errors', description: 'Check PM2 error logs', command: 'pm2 logs --err --lines 50 --nostream 2>&1 | head -100', category: 'logs', timeout: 15000 },
  { id: 'syslog-errors', description: 'Check system log errors', command: 'grep -iE "error|exception|crash|segfault" /var/log/syslog 2>&1 | tail -20', category: 'logs', timeout: 10000 },
  { id: 'systemd-failed', description: 'Check failed systemd units', command: 'systemctl --failed --no-pager 2>&1 | head -20', category: 'process', timeout: 10000 },
  { id: 'docker-status', description: 'Check Docker containers', command: 'docker ps -a --format "{{.Names}}|{{.Status}}|{{.Ports}}" 2>&1 | head -20', category: 'process', timeout: 15000 },

  // Resources
  { id: 'memory', description: 'Check memory', command: 'free -h', category: 'resources', timeout: 5000 },
  { id: 'disk', description: 'Check disk', command: 'df -h /', category: 'resources', timeout: 5000 },
  { id: 'load', description: 'Check load', command: 'uptime', category: 'resources', timeout: 5000 },
  { id: 'oom-events', description: 'Check OOM kills', command: 'dmesg 2>/dev/null | grep -iE "killed process|out of memory" | tail -10', category: 'resources', timeout: 10000 },

  // Network
  { id: 'listening', description: 'Check listening ports', command: 'ss -tlnp 2>/dev/null | head -20', category: 'network', timeout: 5000 },

  // Project ({{ROOT}} is substituted with the active project root at run time)
  { id: 'project-root', description: 'Check project dir', command: 'ls -la {{ROOT}}/ 2>&1 | head -20', category: 'config', timeout: 5000 },
  { id: 'recent-releases', description: 'Check recent releases', command: 'ls -lat {{ROOT}}/releases/ 2>&1 | head -10', category: 'config', timeout: 5000 }
]

const PROJECT_ROOT_TOKEN = '{{ROOT}}'

/**
 * POSIX single-quote a value for safe embedding in a shell command (B-18). The
 * project root is user-controlled (it may contain spaces, quotes or
 * metacharacters), so an unquoted substitution would let a root such as
 * `/srv/my app` — or `/srv/it's` — break the probe command apart. Same rule as
 * `src/core/agent/preflight.ts`.
 */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/** Resolve the project probes against the active project root. */
export function buildCrashProbes(projectRoot?: string): DiagnosisProbe[] {
  const root = (projectRoot && projectRoot.trim() ? projectRoot.trim() : '.').replace(/\/+$/, '') || '/'
  const quoted = shellQuote(root)
  return CRASH_PROBES.map((probe) => ({
    ...probe,
    command: probe.command.split(PROJECT_ROOT_TOKEN).join(quoted)
  }))
}

export interface DiagnosisEvidence {
  probeId: string
  description: string
  command: string
  output: string
  exitCode: number
  ok: boolean
  /** Probe referenced a system path Diagnostic Mode does not expose. */
  skipped?: boolean
}

export type DiagnosisConfidence = 'high' | 'medium' | 'low' | 'unknown'

export interface DiagnosisConclusion {
  cause: string
  confidence: DiagnosisConfidence
  recommendations: string[]
  evidenceSummary: string
}

export interface DiagnosisResult {
  evidence: DiagnosisEvidence[]
  diagnosis: DiagnosisConclusion
}

export interface CrashDiagnosisExecResult {
  stdout: string
  stderr: string
  exitCode: number
}

export interface CrashDiagnosisDeps {
  exec(command: string, timeoutMs: number): Promise<CrashDiagnosisExecResult>
  diagnostic?: DiagnosticPolicy | null
  /** Absolute root of the active project; substituted into the project probes. */
  projectRoot?: string
  /** Injectable clock so the diagnostic TTL can be tested without sleeping. */
  now?: () => number
}

/** System locations a probe cannot read without Diagnostic Mode. */
const SYSTEM_PATH_RE = /\/(?:var|proc|etc|root)\//

function isDiagnosticActive(policy: DiagnosticPolicy | null | undefined, now: number): boolean {
  return Boolean(policy?.enabled) && now <= (policy?.expiresAt ?? 0)
}

/** Absolute paths a probe command references (for the Diagnostic Mode check). */
function probePaths(command: string): string[] {
  return command.match(/\/[A-Za-z0-9_\-./]+/g) ?? []
}

/** True when the probe must be skipped because Diagnostic Mode is off. */
function isProbeBlocked(probe: DiagnosisProbe, deps: CrashDiagnosisDeps, now: number): boolean {
  if (!SYSTEM_PATH_RE.test(probe.command)) return false
  if (isDiagnosticActive(deps.diagnostic, now)) return false
  // A system path the diagnostic policy already exposes is still readable.
  return probePaths(probe.command).every((candidate) => !isDiagnosticAllowed(candidate, deps.diagnostic))
}

/**
 * Run every probe (skipping the ones Diagnostic Mode does not permit) and reduce
 * the collected evidence to a probable cause. Never throws: a failing probe is
 * recorded as evidence with `ok: false`.
 */
export async function runCrashDiagnosis(
  deps: CrashDiagnosisDeps,
  probes: DiagnosisProbe[] = buildCrashProbes(deps.projectRoot)
): Promise<DiagnosisResult> {
  const now = deps.now?.() ?? Date.now()
  const evidence: DiagnosisEvidence[] = []

  for (const probe of probes) {
    if (isProbeBlocked(probe, deps, now)) {
      evidence.push({
        probeId: probe.id,
        description: probe.description,
        command: probe.command,
        output: '[skipped - Diagnostic Mode not enabled]',
        exitCode: -1,
        ok: false,
        skipped: true
      })
      continue
    }

    try {
      const result = await deps.exec(probe.command, probe.timeout)
      const output = `${result.stdout}${result.stderr}`.trim()
      evidence.push({
        probeId: probe.id,
        description: probe.description,
        command: probe.command,
        output: output.slice(0, 2000),
        exitCode: result.exitCode,
        ok: result.exitCode === 0
      })
    } catch (error) {
      evidence.push({
        probeId: probe.id,
        description: probe.description,
        command: probe.command,
        output: error instanceof Error ? error.message : String(error),
        exitCode: -1,
        ok: false
      })
    }
  }

  return { evidence, diagnosis: analyzeEvidence(evidence) }
}

/** Reduce collected evidence to a probable cause with recommendations. */
export function analyzeEvidence(evidence: DiagnosisEvidence[]): DiagnosisConclusion {
  const find = (id: string): DiagnosisEvidence | undefined =>
    evidence.find((entry) => entry.probeId === id)

  // 1. PM2 error log.
  const pm2Errors = find('pm2-errors')
  if (pm2Errors?.ok && /error|exception|crash/i.test(pm2Errors.output)) {
    return {
      cause: 'pm2_process_error',
      confidence: 'high',
      recommendations: [
        'Check PM2 logs: pm2 logs <app-name>',
        'Review recent code changes',
        'Consider restarting: pm2 restart <app-name>'
      ],
      evidenceSummary: 'PM2 logs show error/exception'
    }
  }

  // 2. Out of memory.
  const oom = find('oom-events')
  if (oom?.ok && oom.output.trim().length > 0) {
    return {
      cause: 'out_of_memory',
      confidence: 'high',
      recommendations: ['Increase memory limit', 'Check for memory leaks', 'Consider swap file'],
      evidenceSummary: 'dmesg shows OOM kills'
    }
  }

  // 3. Disk full.
  const disk = find('disk')
  if (disk?.ok) {
    const match = disk.output.match(/(\d+)%/)
    if (match && Number.parseInt(match[1], 10) > 90) {
      return {
        cause: 'disk_full',
        confidence: 'high',
        recommendations: ['Clean up old releases', 'Check log rotation', 'Remove unused files'],
        evidenceSummary: `Disk usage at ${match[1]}%`
      }
    }
  }

  // 4. Failed systemd units.
  const systemd = find('systemd-failed')
  if (systemd?.ok && systemd.output.trim() && !/0 loaded units/.test(systemd.output)) {
    return {
      cause: 'systemd_service_failed',
      confidence: 'medium',
      recommendations: [
        'Check: systemctl status <failed-unit>',
        'Review: journalctl -u <failed-unit> -n 100'
      ],
      evidenceSummary: 'Failed systemd units detected'
    }
  }

  // 5. No clear cause.
  return {
    cause: 'unknown',
    confidence: 'low',
    recommendations: [
      'Enable Diagnostic Mode and retry',
      'Check specific service logs manually',
      'Provide more context about the crash'
    ],
    evidenceSummary: 'No clear cause found in standard probes'
  }
}

/** Render the diagnosis as the model-facing text returned by `diagnose_crash`. */
export function formatDiagnosis(result: DiagnosisResult): string {
  const lines = ['== Evidence ==']
  for (const entry of result.evidence) {
    lines.push(`- ${entry.description} (${entry.command})`)
    if (entry.output) lines.push(`  ${entry.output.split('\n').slice(0, 8).join('\n  ')}`)
  }
  const { diagnosis } = result
  lines.push('', '== Diagnosis ==')
  lines.push(`Cause: ${diagnosis.cause} (confidence: ${diagnosis.confidence.toUpperCase()})`)
  lines.push(`Summary: ${diagnosis.evidenceSummary}`)
  lines.push('Recommendations:')
  for (const recommendation of diagnosis.recommendations) lines.push(`- ${recommendation}`)
  return lines.join('\n')
}
