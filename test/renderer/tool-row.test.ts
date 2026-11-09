import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/*
 * The collapsed tool row is the product's signature surface: it is the one place where a command, its outcome and its
 * duration are readable at a glance, and every one of them is on one 32px line. Its height is therefore a contract, not a
 * preference — a py-1 that grows with a two-line headline would make the transcript jump as results arrive.
 *
 * The component keeps concrete Tailwind classes, so this reads the source: a fixed height class on the header, no vertical
 * padding that would fight it, and the four facts the row promises.
 */
const SOURCE = readFileSync(
  join(__dirname, '..', '..', 'src', 'renderer', 'src', 'components', 'ToolResultCard.tsx'),
  'utf8'
)

describe('the collapsed tool row', () => {
  it('is a fixed 32px line', () => {
    expect(SOURCE).toContain('data-testid="tool-card-header"')
    expect(SOURCE).toMatch(/data-testid="tool-card-header"\s*\n\s*className="[^"]*\bh-8\b/)
    // A vertical padding would make the height depend on the text instead of the design.
    expect(SOURCE).not.toMatch(/data-testid="tool-card-header"\s*\n\s*className="[^"]*\bpy-/)
  })

  it('carries the verb, the state word and the duration in that one line', () => {
    expect(SOURCE).toContain('data-testid="tool-card-state"')
    expect(SOURCE).toContain('{statusLabel}')
    // statusLabel and seconds both render inside the header block, before the expand chevron.
    const header = SOURCE.slice(SOURCE.indexOf('data-testid="tool-card-header"'))
    const chevron = header.indexOf('ChevronDown')
    expect(header.indexOf('{statusLabel}')).toBeGreaterThan(-1)
    expect(header.slice(0, chevron).includes('{seconds}')).toBe(true)
  })
})
