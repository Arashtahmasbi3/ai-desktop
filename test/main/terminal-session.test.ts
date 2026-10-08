import { describe, it, expect } from 'vitest'
import { TerminalSession } from '../../src/main/ssh/terminal-session'
import type { SshShell } from '../../src/main/ssh/backend'

function createFakeShell(): {
  shell: SshShell
  emit: (chunk: string) => void
  emitClose: () => void
  writes: string[]
  resizes: Array<[number, number]>
  closed: () => boolean
} {
  let onData: ((chunk: string) => void) | undefined
  let onClose: (() => void) | undefined
  const writes: string[] = []
  const resizes: Array<[number, number]> = []
  let closed = false
  const shell: SshShell = {
    write: (data) => writes.push(data),
    resize: (cols, rows) => resizes.push([cols, rows]),
    close: () => {
      closed = true
    },
    onData: (listener) => {
      onData = listener
    },
    onClose: (listener) => {
      onClose = listener
    }
  }
  return {
    shell,
    emit: (chunk) => onData?.(chunk),
    emitClose: () => onClose?.(),
    writes,
    resizes,
    closed: () => closed
  }
}

describe('terminal session', () => {
  it('forwards writes and resizes to the shell', () => {
    const fake = createFakeShell()
    const session = new TerminalSession(fake.shell, { id: 't1' })
    session.write('ls\n')
    session.resize(120, 40)
    session.close()
    expect(fake.writes).toEqual(['ls\n'])
    expect(fake.resizes).toEqual([[120, 40]])
    expect(fake.closed()).toBe(true)
  })

  it('forwards shell output to onData and tracks activity', () => {
    let now = 0
    const received: string[] = []
    const fake = createFakeShell()
    const session = new TerminalSession(fake.shell, {
      id: 't1',
      now: () => now,
      onData: (id, chunk) => received.push(`${id}:${chunk}`)
    })
    fake.emit('hello')
    expect(received).toEqual(['t1:hello'])
    now = 5_000
    expect(session.isIdle(60_000)).toBe(false)
    now = 70_000
    expect(session.isIdle(60_000)).toBe(true)
  })

  it('reports close to the owner', () => {
    const closed: string[] = []
    const fake = createFakeShell()
    const session = new TerminalSession(fake.shell, {
      id: 't9',
      onClose: (id) => closed.push(id)
    })
    fake.emitClose()
    expect(closed).toEqual(['t9'])
    expect(session.id).toBe('t9')
  })
})
