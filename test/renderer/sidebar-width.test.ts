import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SIDEBAR_EXPANDED_WIDTH, SIDEBAR_RAIL_WIDTH } from '../../src/renderer/src/lib/layout'

/*
 * The plan and the screen must agree on one number.
 *
 * When they did not, resolveLayout computed every dock decision with a 372px sidebar while the DOM drew 256px, so the
 * arithmetic described a layout nobody could see. The component keeps concrete Tailwind classes (a dynamic width in a
 * class would purge), so this test is the link: change the constant and it fails until the class follows.
 */
const SIDEBAR = readFileSync(join(__dirname, '..', '..', 'src', 'renderer', 'src', 'components', 'Sidebar.tsx'), 'utf8')

describe('the sidebar draws the widths the layout decides with', () => {
  it('uses SIDEBAR_RAIL_WIDTH for the rail', () => {
    expect(SIDEBAR).toContain('w-[' + SIDEBAR_RAIL_WIDTH + 'px]')
  })

  it('uses SIDEBAR_EXPANDED_WIDTH for the expanded list', () => {
    expect(SIDEBAR).toContain('w-[' + SIDEBAR_EXPANDED_WIDTH + 'px]')
  })

  it('has no stale fixed width left over', () => {
    expect(SIDEBAR).not.toMatch(/\bw-64\b/)
    expect(SIDEBAR).not.toMatch(/\bw-14\b/)
  })
})
