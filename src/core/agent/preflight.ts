import { shellQuote } from '@shared/shell-quote'
/**
 * Preflight state checks before sensitive actions (v2.4, A.2).
 *
 * Before the agent mutates a remote workspace we cheaply inspect it: does the path
 * exist, is the git tree dirty, is the disk nearly full, is the deploy target
 * reachable. The result drives a warning banner and lets a `fail` block the action.
 * Everything goes through an injected `exec`, so `core` stays node-free and the
 * whole thing is unit-testable without SSH.
 */

export type PreflightStatus = 'pass' | 'fail' | 'warn'

/**
 * v2.6.3 T3.1 - UI severity tier derived from the raw checks. Kept separate from
 * {@link PreflightStatus} so the core stays minimal while the banner can colour
 * itself and decide whether an override is even conceivable.
 */
export type PreflightTier = 'ok' | 'warn' | 'block' | 'critical'

export interface PreflightCheck {
  name: string
  status: PreflightStatus
  message: string
}

export interface PreflightResult {
  ok: boolean
  checks: PreflightCheck[]
}

/**
 * Classify a result into a tier the UI can render:
 * - `critical`: the workspace itself is unreachable — nothing can proceed safely.
 * - `block`: a hard failure elsewhere (e.g. disk full) that blocked the action.
 * - `warn`: non-fatal advisories only.
 * - `ok`: every check passed.
 */
export function preflightTier(result: PreflightResult): PreflightTier {
  const failed = result.checks.filter((check) => check.status === 'fail')
  if (failed.length === 0) {
    return result.checks.some((check) => check.status === 'warn') ? 'warn' : 'ok'
  }
  if (failed.some((check) => check.name === 'workspace')) return 'critical'
  return 'block'
}

export interface PreflightWorkspace {
  path: string
  isGitRepo?: boolean
}

/** Actions that trigger the disk-space check. */
const DISK_ACTIONS = new Set(['write', 'build', 'install'])

export interface PreflightExecResult {
  ok: boolean
  stdout: string
  stderr?: string
  exitCode?: number
}

export type PreflightExec = (command: string) => Promise<PreflightExecResult>

/** POSIX single-quote a value for safe embedding in a shell command. */

/** Pure classification so the UI can decide what to show. */
export function preflightWarnings(result: PreflightResult): PreflightCheck[] {
  return result.checks.filter((check) => check.status !== 'pass')
}

/**
 * Map a tool call to the preflight "action" it represents, or `undefined` when the
 * call is read-only and needs no check. Kept pure for unit tests.
 */
export function preflightActionFor(
  toolName: string,
  args: Record<string, unknown>
): string | undefined {
  if (/deploy|publish|release/i.test(toolName) || args.action === 'deploy') return 'deploy'
  if (/install|setup/i.test(toolName)) return 'install'
  if (/build/i.test(toolName)) return 'build'
  if (/write|create|edit|patch|delete|remove|move|rename/i.test(toolName)) return 'write'
  return undefined
}

/** Parse `df --output=pcent` output (" 84%") into a number. */
export function parseDiskPercent(stdout: string): number | undefined {
  const match = stdout.match(/(\d+)\s*%/)
  if (!match) return undefined
  const value = Number(match[1])
  return Number.isFinite(value) ? value : undefined
}

export async function preflight(
  exec: PreflightExec,
  workspace: PreflightWorkspace,
  action: string
): Promise<PreflightResult> {
  const checks: PreflightCheck[] = []

  const exists = await exec(`test -d ${shellQuote(workspace.path)} && echo yes || echo no`)
  const present = exists.ok && exists.stdout.trim() === 'yes'
  checks.push({
    name: 'workspace',
    status: present ? 'pass' : 'fail',
    message: present ? 'Workspace exists' : `Workspace not found: ${workspace.path}`
  })

  if (present && workspace.isGitRepo) {
    const dirty = await exec(`cd ${shellQuote(workspace.path)} && git status --porcelain`)
    const lines = dirty.ok ? dirty.stdout.trim() : ''
    if (lines) {
      const count = lines.split('\n').length
      checks.push({
        name: 'git-clean',
        status: 'warn',
        message: `${count} uncommitted file(s). Commit first?`
      })
    } else {
      checks.push({ name: 'git-clean', status: 'pass', message: 'Git tree clean' })
    }
  }

  if (DISK_ACTIONS.has(action)) {
    const df = await exec(`df -h ${shellQuote(workspace.path)} --output=pcent | tail -1`)
    const percent = parseDiskPercent(df.stdout)
    if (percent === undefined) {
      checks.push({ name: 'disk', status: 'warn', message: 'Could not read disk usage' })
    } else if (percent > 90) {
      checks.push({ name: 'disk', status: 'fail', message: `Disk ${percent}% full` })
    } else {
      checks.push({ name: 'disk', status: 'pass', message: `Disk ${percent}% used` })
    }
  }

  if (action === 'deploy') {
    const pm2 = await exec('pm2 list')
    checks.push({
      name: 'pm2',
      status: pm2.ok ? 'pass' : 'warn',
      message: pm2.ok ? 'PM2 accessible' : 'PM2 not available — deploy may fail'
    })
  }

  return { ok: !checks.some((check) => check.status === 'fail'), checks }
}
