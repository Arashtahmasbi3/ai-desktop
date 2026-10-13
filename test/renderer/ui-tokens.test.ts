import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * U-3 / U-8 / U-9: structural guards for the UI layer.
 *
 * Component tests can assert behaviour, but these three defects are about class
 * *tokens* that silently do nothing (an undefined Tailwind token compiles to no
 * CSS at all). A source sweep is the honest way to keep them from coming back.
 */

const COMPONENTS = join(process.cwd(), 'src/renderer/src/components')

function componentFiles(dir = COMPONENTS): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return componentFiles(path)
    return entry.name.endsWith('.tsx') ? [path] : []
  })
}

function linesOf(file: string): string[] {
  return readFileSync(file, 'utf8').split(/\r?\n/)
}

describe('hover-only controls are also reachable by keyboard (U-3)', () => {
  it('never hides a control behind group-hover without a focus variant', () => {
    const offenders: string[] = []
    for (const file of componentFiles()) {
      for (const [index, line] of linesOf(file).entries()) {
        if (!line.includes('group-hover:block') && !line.includes('group-hover:opacity-100')) continue
        const hasFocusVariant =
          line.includes('group-focus-within:block') ||
          line.includes('focus-visible:block') ||
          line.includes('group-focus-within:opacity-100') ||
          line.includes('focus-visible:opacity-100')
        if (!hasFocusVariant) offenders.push(`${file}:${index + 1}: ${line.trim()}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('ships one global focus-visible indicator instead of none', () => {
    const css = readFileSync(
      join(process.cwd(), 'src/renderer/src/assets/main.css'),
      'utf8'
    )
    expect(css).toContain(':root :focus-visible')
    expect(css).toMatch(/outline:\s*2px solid/)
  })
})

describe('no undefined Tailwind tokens (U-8)', () => {
  it('never uses text-text-* (not in tailwind.config.js)', () => {
    const offenders: string[] = []
    for (const file of componentFiles()) {
      for (const [index, line] of linesOf(file).entries()) {
        if (line.includes('text-text-')) offenders.push(`${file}:${index + 1}: ${line.trim()}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('never uses a bare z-60 (Tailwind has no such step)', () => {
    const offenders: string[] = []
    for (const file of componentFiles()) {
      for (const [index, line] of linesOf(file).entries()) {
        if (/(^|["' ])z-60(?!\d)/.test(line)) offenders.push(`${file}:${index + 1}: ${line.trim()}`)
      }
    }
    expect(offenders).toEqual([])
  })
})

describe('readable contrast in the flagged surfaces (U-9)', () => {
  it('keeps neutral-600/neutral-700 out of the dark chrome', () => {
    const flagged = [
      'Sidebar.tsx',
      'StatusBar.tsx',
      'MessageBubble.tsx',
      'CodeViewer.tsx'
    ]
    const offenders: string[] = []
    for (const name of flagged) {
      const file = join(COMPONENTS, name)
      for (const [index, line] of linesOf(file).entries()) {
        if (line.includes('text-neutral-600') || line.includes('text-neutral-700')) {
          offenders.push(`${name}:${index + 1}: ${line.trim()}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })
})
