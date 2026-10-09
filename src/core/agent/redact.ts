/**
 * Secret redaction for logs, audit entries and user-facing errors.
 * Dependency-free so it can run in the main process, the renderer and tests.
 */

/** High-confidence credential shapes. Order matters: the private-key block first. */
export const REDACTION_PATTERNS: ReadonlyArray<{ name: string; pattern: RegExp }> = [
  {
    name: 'private-key',
    pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]+?-----END [A-Z0-9 ]*PRIVATE KEY-----/g
  },
  { name: 'anthropic-key', pattern: /sk-ant-[A-Za-z0-9_-]{16,}/g },
  { name: 'openai-key', pattern: /sk-[A-Za-z0-9]{16,}/g },
  { name: 'github-pat', pattern: /gh[pousr]_[A-Za-z0-9]{20,}/g },
  { name: 'github-fine-grained', pattern: /github_pat_[A-Za-z0-9_]{20,}/g },
  { name: 'aws-access-key', pattern: /AKIA[0-9A-Z]{16}/g },
  { name: 'slack-token', pattern: /xox[baprs]-[A-Za-z0-9-]{10,}/g },
  { name: 'jwt', pattern: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
  { name: 'bearer', pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi },
  { name: 'password', pattern: /(password|passwd|pwd)\s*[=:]\s*\S+/gi },
  { name: 'api-key', pattern: /(api[_-]?key|apikey|secret|token)\s*[=:]\s*\S+/gi },
  { name: 'dsn', pattern: /(postgres|mysql|mongodb|redis):\/\/[^\s@]+@\S+/gi }
]

const REDACTED = '[REDACTED]'

/** Replace every recognised secret in `text` with `[REDACTED]`. */
export function redact(text: string): string {
  if (!text) return text
  let result = text
  for (const { pattern } of REDACTION_PATTERNS) {
    // Reset lastIndex because the patterns are shared and global.
    pattern.lastIndex = 0
    result = result.replace(pattern, REDACTED)
  }
  return result
}

/** Deep-redact every string inside a plain value (objects/arrays included). */
export function redactValue<T>(value: T): T {
  if (typeof value === 'string') return redact(value) as unknown as T
  if (Array.isArray(value)) return value.map((item) => redactValue(item)) as unknown as T
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = redactValue(item)
    }
    return out as unknown as T
  }
  return value
}

/** Redact an error's message, returning a safe string. */
export function redactError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return redact(message)
}
