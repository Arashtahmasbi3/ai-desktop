import { describe, it, expect } from 'vitest'
import {
  normalizeSandboxPath,
  resolveInsideWorkspace,
  resolveWorkspaceDir,

  toContainerPath
} from '@core/sandbox/paths'
import { shellQuote } from '@shared/shell-quote'
import { PathEscapeError } from '@core/sandbox/errors'

describe('normalizeSandboxPath', () => {
  it('keeps simple relative paths', () => {
    expect(normalizeSandboxPath('a/b.txt')).toBe('a/b.txt')
    expect(normalizeSandboxPath('./a/b.txt')).toBe('a/b.txt')
  })

  it('normalizes redundant segments', () => {
    expect(normalizeSandboxPath('a/./b/../c.txt')).toBe('a/c.txt')
  })

  it('accepts Windows separators and converts them', () => {
    expect(normalizeSandboxPath('a\\b\\c.txt')).toBe('a/b/c.txt')
  })

  it('rejects escapes and absolute paths', () => {
    expect(() => normalizeSandboxPath('../etc/passwd')).toThrow(PathEscapeError)
    expect(() => normalizeSandboxPath('a/../../etc')).toThrow(PathEscapeError)
    expect(() => normalizeSandboxPath('/etc/passwd')).toThrow(PathEscapeError)
    expect(() => normalizeSandboxPath('C:\\Windows\\system32')).toThrow(PathEscapeError)
    expect(() => normalizeSandboxPath('..')).toThrow(PathEscapeError)
    expect(() => normalizeSandboxPath('.')).toThrow(PathEscapeError)
    expect(() => normalizeSandboxPath('')).toThrow(PathEscapeError)
  })
})

describe('resolveInsideWorkspace', () => {
  it('resolves paths contained by the workspace', () => {
    const root = '/tmp/sbx-root'
    expect(resolveInsideWorkspace(root, 'a/b.txt')).toBe('/tmp/sbx-root/a/b.txt')
  })

  it('rejects paths that would escape', () => {
    expect(() => resolveInsideWorkspace('/tmp/sbx-root', '../escape.txt')).toThrow(PathEscapeError)
  })
})

describe('resolveWorkspaceDir', () => {
  it('returns the root for empty / dot cwd', () => {
    expect(resolveWorkspaceDir('/tmp/sbx-root', undefined)).toBe('/tmp/sbx-root')
    expect(resolveWorkspaceDir('/tmp/sbx-root', '.')).toBe('/tmp/sbx-root')
  })

  it('resolves nested cwd and rejects escape', () => {
    expect(resolveWorkspaceDir('/tmp/sbx-root', 'sub/dir')).toBe('/tmp/sbx-root/sub/dir')
    expect(() => resolveWorkspaceDir('/tmp/sbx-root', '../..')).toThrow(PathEscapeError)
  })
})

describe('toContainerPath', () => {
  it('maps to the container workspace', () => {
    expect(toContainerPath('a/b.txt')).toBe('/workspace/a/b.txt')
    expect(toContainerPath('a/b.txt', '/work')).toBe('/work/a/b.txt')
  })
})

describe('shellQuote', () => {
  it('wraps and escapes single quotes', () => {
    expect(shellQuote('plain')).toBe("'plain'")
    expect(shellQuote("it's")).toBe("'it'\\''s'")
  })
})
