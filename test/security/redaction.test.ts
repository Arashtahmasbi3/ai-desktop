import { describe, it, expect } from 'vitest'
import { redact, redactError, redactValue } from '@core/agent/redact'
import { JsonLogger, MemoryLogger, makeLogEntry } from '@core/agent/logger'
import { AuditLog } from '@core/agent/audit-log'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

describe('redact (Task B.1)', () => {
  it('masks OpenAI-style keys', () => {
    expect(redact('key sk-abcdefghijklmnopqrstuvwxyz012345')).not.toContain('sk-abc')
    expect(redact('key sk-abcdefghijklmnopqrstuvwxyz012345')).toContain('[REDACTED]')
  })

  it('masks Anthropic keys without leaving an sk- fragment', () => {
    const out = redact('sk-ant-api03-abcdefghijklmnopqrstuvwxyz')
    expect(out).toBe('[REDACTED]')
  })

  it('masks GitHub PATs and fine-grained tokens', () => {
    expect(redact('ghp_' + 'a'.repeat(36))).toBe('[REDACTED]')
    expect(redact('github_pat_' + 'A1'.repeat(15))).toBe('[REDACTED]')
  })

  it('masks AWS access key ids', () => {
    expect(redact('AKIAIOSFODNN7EXAMPLE')).toBe('[REDACTED]')
  })

  it('masks Authorization bearer headers', () => {
    expect(redact('Authorization: Bearer abc.def-ghi_123')).toBe('Authorization: [REDACTED]')
  })

  it('masks password / api-key / token assignments', () => {
    expect(redact('password=hunter2')).toBe('[REDACTED]')
    expect(redact('api_key: sk-live-1234567890abcdef')).toBe('[REDACTED]')
    expect(redact('TOKEN: abcdef123456')).not.toContain('abcdef123456')
  })

  it('masks private key blocks entirely', () => {
    const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIEabc123\n-----END RSA PRIVATE KEY-----'
    expect(redact(`before ${pem} after`)).toBe('before [REDACTED] after')
  })

  it('masks connection-string credentials', () => {
    expect(redact('postgres://user:s3cret@db.internal:5432/app')).not.toContain('s3cret')
  })

  it('masks JWTs', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk'
    expect(redact(jwt)).toBe('[REDACTED]')
  })

  it('leaves ordinary text untouched', () => {
    expect(redact('fix the build in src/main/index.ts')).toBe('fix the build in src/main/index.ts')
  })
})

describe('redactValue (Task B.1)', () => {
  it('deep-redacts nested objects and arrays', () => {
    const value = { a: 'sk-abcdefghijklmnopqrstuvwxyz', b: ['password=pw', 42], c: { d: true } }
    const out = redactValue(value)
    expect(out.a).toBe('[REDACTED]')
    expect(out.b[0]).toBe('[REDACTED]')
    expect(out.b[1]).toBe(42)
    expect(out.c.d).toBe(true)
  })
})

describe('logger redaction (Task B.1)', () => {
  it('JsonLogger never emits a raw secret on its line or entry', () => {
    const lines: string[] = []
    const logger = new JsonLogger((line) => lines.push(line))
    logger.log(
      makeLogEntry('info', 'tool', 'run-1', { detail: 'Authorization: Bearer sk-abcdefghijklmnop' })
    )
    expect(lines[0]).not.toContain('sk-abcdefghijklmnop')
    expect(lines[0]).toContain('[REDACTED]')
  })

  it('MemoryLogger stores redacted entries', () => {
    const logger = new MemoryLogger()
    logger.log(makeLogEntry('error', 'boom', 'run-2', { detail: 'password=letmein' }))
    expect(logger.first('boom')?.detail).toBe('[REDACTED]')
  })
})

describe('audit redaction (Task B.1)', () => {
  it('redacts secrets from recorded commands and detail', async () => {
    const file = join(tmpdir(), `audit-redact-${Date.now()}.json`)
    const log = new AuditLog({ file })
    const entry = await log.record({
      type: 'exec',
      ok: true,
      serverId: 'vps-1',
      command: 'curl -H "Authorization: Bearer sk-abcdefghijklmnop" https://api',
      detail: 'password=topsecret'
    })
    expect(entry.command).not.toContain('sk-abcdefghijklmnop')
    expect(entry.detail).toBe('[REDACTED]')
    const raw = await fs.readFile(file, 'utf8')
    expect(raw).not.toContain('sk-abcdefghijklmnop')
    expect(raw).not.toContain('topsecret')
    await fs.rm(file, { force: true })
  })
})

describe('redactError (Task B.1)', () => {
  it('redacts an Error message', () => {
    expect(redactError(new Error('failed with token: ghp_' + 'a'.repeat(36)))).toBe(
      'failed with [REDACTED]'
    )
    expect(redactError('plain string')).toBe('plain string')
  })
})
