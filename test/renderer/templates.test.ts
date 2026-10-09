import { describe, it, expect } from 'vitest'
import {
  BUILTIN_TEMPLATES,
  addUserTemplate,
  loadUserTemplates,
  removeUserTemplate
} from '../../src/renderer/src/lib/templates'

describe('chat templates', () => {
  it('ships the six built-in templates with unique ids', () => {
    expect(BUILTIN_TEMPLATES).toHaveLength(6)
    expect(new Set(BUILTIN_TEMPLATES.map((template) => template.id)).size).toBe(6)
  })

  it('returns no user templates when storage is unavailable', () => {
    expect(loadUserTemplates()).toEqual([])
  })

  it('adds a user template to the provided list', () => {
    const next = addUserTemplate('My template', 'do the thing', [])
    expect(next).toHaveLength(1)
    expect(next[0]).toMatchObject({ label: 'My template', prompt: 'do the thing' })
    expect(next[0].id).toBeTruthy()
  })

  it('falls back to a default label for a blank name', () => {
    const next = addUserTemplate('   ', 'prompt', [])
    expect(next[0].label).toBe('Template')
  })

  it('removes a user template by id', () => {
    const list = addUserTemplate('A', 'a', [])
    const withB = addUserTemplate('B', 'b', list)
    const removed = removeUserTemplate(list[0].id, withB)
    expect(removed.map((template) => template.label)).toEqual(['B'])
  })
})
