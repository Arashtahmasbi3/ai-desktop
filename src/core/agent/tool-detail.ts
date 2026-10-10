/**
 * Turns a raw {@link AgentToolResult} into the redacted, length-capped shape the
 * chat and logs are allowed to see (v2.5.2).
 *
 * Two invariants:
 *  - Every string passes through {@link redact} first, because stdout/stderr of a
 *    build or a deploy can contain API keys, tokens or passwords.
 *  - Streams are capped (10KB stdout, 2KB stderr, 50 lines) so a chatty command
 *    cannot blow up the event payload or the persisted log.
 */

import type { AgentToolResult } from '@shared/agent'
import type { ToolResultView } from '@shared/ui'
import { redact } from './redact'

export const TOOL_DETAIL_CAPS = {
  stdoutBytes: 10 * 1024,
  stderrBytes: 2 * 1024,
  lines: 50
} as const

const TRUNCATED_MARKER = '… [truncated]'

/** Trim `text` to at most `maxBytes` UTF-8 bytes, then to `maxLines` lines. */
export function capText(text: string, maxBytes: number, maxLines: number = TOOL_DETAIL_CAPS.lines): string {
  if (!text) return text
  let out = text
  let truncated = false

  const lines = out.split('\n')
  if (lines.length > maxLines) {
    out = lines.slice(0, maxLines).join('\n')
    truncated = true
  }

  if (Buffer.byteLength(out, 'utf8') > maxBytes) {
    // Binary-search the longest prefix that fits the byte budget.
    let lo = 0
    let hi = out.length
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2)
      if (Buffer.byteLength(out.slice(0, mid), 'utf8') > maxBytes) hi = mid - 1
      else lo = mid
    }
    out = out.slice(0, lo)
    truncated = true
  }

  return truncated ? `${out}\n${TRUNCATED_MARKER}` : out
}

/** Build the redacted, capped view of a tool result for the UI and logs. */
export function buildToolDetail(result: AgentToolResult): ToolResultView {
  return {
    actionId: result.actionId,
    name: result.name,
    ok: result.ok,
    ...(result.code ? { code: result.code } : {}),
    ...(result.error !== undefined ? { error: redact(result.error) } : {}),
    durationMs: result.durationMs,
    attempts: result.attempts,
    ...(result.command !== undefined ? { command: redact(result.command) } : {}),
    ...(result.serverId !== undefined ? { serverId: result.serverId } : {}),
    ...(result.cwd !== undefined ? { cwd: redact(result.cwd) } : {}),
    ...(result.path !== undefined ? { path: redact(result.path) } : {}),
    ...(result.stdout !== undefined
      ? { stdout: capText(redact(result.stdout), TOOL_DETAIL_CAPS.stdoutBytes) }
      : {}),
    ...(result.stderr !== undefined
      ? { stderr: capText(redact(result.stderr), TOOL_DETAIL_CAPS.stderrBytes) }
      : {}),
    ...(result.exitCode !== undefined ? { exitCode: result.exitCode } : {}),
    ...(result.recovery ? { recovery: result.recovery } : {})
  }
}

/**
 * Flatten a view into the fields we attach to the existing `action.ok/error`
 * log entry (short-term bridge; the `tool:result` event is the long-term path).
 */
export function toolDetailLogFields(view: ToolResultView): Record<string, unknown> {
  return {
    ...(view.command !== undefined ? { command: view.command } : {}),
    ...(view.serverId !== undefined ? { serverId: view.serverId } : {}),
    ...(view.cwd !== undefined ? { cwd: view.cwd } : {}),
    ...(view.path !== undefined ? { path: view.path } : {}),
    ...(view.stdout !== undefined ? { stdout: view.stdout } : {}),
    ...(view.stderr !== undefined ? { stderr: view.stderr } : {}),
    ...(view.exitCode !== undefined ? { exitCode: view.exitCode } : {}),
    ...(view.recovery ? { recovery: view.recovery } : {})
  }
}
