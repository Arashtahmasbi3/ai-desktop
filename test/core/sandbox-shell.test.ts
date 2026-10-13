import { describe, expect, it } from 'vitest'
import {
  bashOnPath,
  pickPosixShell,
  resolveSandboxShell,
  shellDialectMismatch,
  windowsPosixShellCandidates
} from '../../src/core/sandbox/shell'

const WIN_ENV = {
  ProgramFiles: 'C:\\Program Files',
  ProgramW6432: 'C:\\Program Files',
  LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local',
  PATH: 'C:\\Windows\\system32;C:\\Program Files\\Git\\cmd;C:\\tools'
}

describe('sandbox shell resolution', () => {
  it('uses /bin/sh on POSIX', () => {
    const shell = resolveSandboxShell('linux', {}, () => false)
    expect(shell.file).toBe('/bin/sh')
    expect(shell.dialect).toBe('posix')
    expect(shell.args('echo hi')).toEqual(['-c', 'echo hi'])
  })

  it('prefers Git for Windows bash so POSIX agent commands actually run', () => {
    const bash = 'C:\\Program Files\\Git\\bin\\bash.exe'
    const shell = resolveSandboxShell('win32', WIN_ENV, (candidate) => candidate === bash)
    expect(shell.file).toBe(bash)
    expect(shell.dialect).toBe('posix')
    expect(shell.args('cat id.txt')).toEqual(['-c', 'cat id.txt'])
  })

  it('falls back to cmd.exe and reports the mismatch when no POSIX shell exists', () => {
    const shell = resolveSandboxShell('win32', WIN_ENV, () => false)
    expect(shell.file).toBe('cmd.exe')
    expect(shell.dialect).toBe('cmd')
    expect(shellDialectMismatch(shell)).toBe(true)
  })

  it('never picks the System32 bash.exe shim (WSL without a distro)', () => {
    const candidates = windowsPosixShellCandidates(WIN_ENV)
    expect(candidates.some((c) => /system32[\\/]bash\.exe$/i.test(c))).toBe(false)
    expect(bashOnPath(WIN_ENV).some((c) => /system32/i.test(c))).toBe(false)
  })

  it('orders real Git install paths ahead of anything found on PATH', () => {
    const candidates = windowsPosixShellCandidates(WIN_ENV)
    const install = candidates.findIndex((c) => c.toLowerCase() === 'c:\\program files\\git\\bin\\bash.exe')
    const onPath = candidates.findIndex((c) => c.toLowerCase() === 'c:\\tools\\bash.exe')
    expect(install).toBeGreaterThanOrEqual(0)
    expect(onPath).toBeGreaterThan(install)
  })

  it('resolves one shell descriptor from a candidate list', () => {
    expect(pickPosixShell(['a', 'b'], (c) => c === 'b')?.file).toBe('b')
    expect(pickPosixShell(['a'], () => false)).toBeNull()
  })
})
