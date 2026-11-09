import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/*
 * An overlay's radius belongs to its role, not to a component's class list.
 *
 * This codebase has no shared menu primitive: six surfaces each carry their own classes, so a radius rule written per
 * component drifts the first time a seventh is added. The roles are already present on every one of them, which makes the
 * stylesheet the one place the rule can be stated once.
 */
const CSS = readFileSync(join(__dirname, '..', '..', 'src', 'renderer', 'src', 'assets', 'main.css'), 'utf8')

describe('overlay shape by role', () => {
  it('gives a menu and a listbox the 16px step', () => {
    expect(CSS).toMatch(/\[role='menu'\],\s*\n\[role='listbox'\] \{\s*\n\s*border-radius: var\(--shape-r-xl\);/)
  })

  it('gives a dialog the 12px step', () => {
    expect(CSS).toMatch(/\[role='dialog'\] \{\s*\n\s*border-radius: var\(--shape-r-lg\);/)
  })

  it('keeps the menu row at its own measured height', () => {
    expect(CSS).toContain('.ui-row-menu')
    expect(CSS).toMatch(/\.ui-row-menu \{[^}]*height: var\(--row-h-menu\)/)
  })
})