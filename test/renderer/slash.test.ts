import { describe, it, expect } from 'vitest'
import { filterSlashCommands, resolveSlashCommand } from '../../src/renderer/src/lib/slash'

const COMMANDS = [
  { id: 'new' },
  { id: 'clear' },
  { id: 'settings' },
  { id: 'plan' }
]

describe('filterSlashCommands', () => {
  it('closes the menu for empty input or plain text', () => {
    expect(filterSlashCommands(COMMANDS, '')).toEqual([])
    expect(filterSlashCommands(COMMANDS, 'hello')).toEqual([])
  })

  it('matches by prefix, case-insensitively, ignoring leading whitespace', () => {
    expect(filterSlashCommands(COMMANDS, '/cl').map((c) => c.id)).toEqual(['clear'])
    expect(filterSlashCommands(COMMANDS, '  /SET').map((c) => c.id)).toEqual(['settings'])
  })

  it('lists every command for a bare slash and closes once args are typed', () => {
    expect(filterSlashCommands(COMMANDS, '/')).toHaveLength(4)
    expect(filterSlashCommands(COMMANDS, '/plan now')).toEqual([])
  })
})

describe('resolveSlashCommand', () => {
  it('resolves an exact command and rejects arguments/unknown commands', () => {
    expect(resolveSlashCommand(COMMANDS, ' /plan ')?.id).toBe('plan')
    expect(resolveSlashCommand(COMMANDS, '/plan now')).toBeUndefined()
    expect(resolveSlashCommand(COMMANDS, '/nope')).toBeUndefined()
    expect(resolveSlashCommand(COMMANDS, 'plan')).toBeUndefined()
  })
})
