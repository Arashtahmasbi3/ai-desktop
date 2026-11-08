import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CHAT_MAX_WIDTH,
  SIDEBAR_EXPANDED_WIDTH,
  WORKSPACE_PANEL_WIDTH,
  resolveLayout
} from '../../src/renderer/src/lib/layout'

/*
 * Audit finding 4: at a 1200px window the workspace panel is an overlay (the layout plan says so below), and an overlay
 * drawn full height reaches the bottom of the chat column — over the send button and the model selector. The default is
 * `workspacePanelOpen: true`, so this happened on first launch at the most common laptop width, and a screenshot showed
 * the composer cut off and the send button hidden behind the panel.
 *
 * The fix is stacking, not layout: the composer strip sits above the drawer, so the primary action is clickable at any
 * width and the peek panel simply ends behind it. That is asserted two ways — the plan still says overlay at 1200 (so
 * nobody "fixes" this by changing the rule), and the strip really does outrank the drawer in z-order (so nobody restyles
 * it back under the panel).
 */
const COMPONENTS = join(__dirname, '..', '..', 'src', 'renderer', 'src', 'components')

/** The class list on the first element whose props match. Fails loudly rather than returning ''. */
function classFor(file: string, marker: string): string {
  const source = readFileSync(join(COMPONENTS, file), 'utf8')
  const index = source.indexOf(marker)
  expect(index, marker + ' not found in ' + file).toBeGreaterThan(-1)
  const window = source.slice(Math.max(0, index - 600), index + 600)
  const match = window.match(/className=(?:"([^"]+)"|\{`([^`]+)`\})/)
  expect(match, 'no className near ' + marker + ' in ' + file).toBeTruthy()
  return (match?.[1] ?? match?.[2] ?? '') as string
}

const zIndexIn = (classes: string): number => {
  const match = classes.match(/\bz-(\d+)\b/)
  return match ? Number(match[1]) : 0
}

describe('the composer is never behind the workspace drawer', () => {
  it('the layout plan still overlays the workspace panel at a 1200px window', () => {
    const plan = resolveLayout({
      width: 1200,
      sidebarPinned: false,
      sidebarCollapsed: false,
      treeOpen: false,
      workspaceOpen: true
    })
    expect(plan.workspace).toBe('overlay')
    /* Sanity: the arithmetic that makes it an overlay, so a constant change shows up here and not as a regression. */
    expect(1200 - SIDEBAR_EXPANDED_WIDTH - WORKSPACE_PANEL_WIDTH).toBeLessThan(CHAT_MAX_WIDTH)
  })

  it('the composer strip outranks the drawer, and says why', () => {
    const strip = classFor('ChatPanel.tsx', 'data-testid="chat-composer"')
    const drawer = classFor('WorkspacePanel.tsx', 'absolute inset-y-0 end-0 z-')
    expect(zIndexIn(strip)).toBeGreaterThan(zIndexIn(drawer))
  })

  it('the composer strip is opaque, or the drawer would read through it', () => {
    const strip = classFor('ChatPanel.tsx', 'data-testid="chat-composer"')
    const source = readFileSync(join(COMPONENTS, 'ChatPanel.tsx'), 'utf8')
    const index = source.indexOf('data-testid="chat-composer"')
    const window = source.slice(Math.max(0, index - 900), index)
    expect(window).toMatch(/bg-bg-(primary|secondary)/)
    expect(strip.length).toBeGreaterThan(0)
  })
})
