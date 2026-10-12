/**
 * v2.6.3 Topic 1 - layout math. At 1366px an expanded sidebar + docked file tree +
 * docked workspace panel used to leave the chat ~500px; the rules below keep the
 * conversation at its comfortable measure by overlaying columns that do not fit.
 */
import { describe, expect, it } from 'vitest'
import {
  CHAT_MAX_WIDTH,
  MIN_CHAT_WIDTH,
  SIDEBAR_EXPANDED_WIDTH,
  TREE_PANEL_WIDTH,
  WORKSPACE_PANEL_WIDTH,
  resolveLayout
} from '../../src/renderer/src/lib/layout'

const everythingOpen = { sidebarPinned: true, treeOpen: true, workspaceOpen: true }

describe('resolveLayout', () => {
  it('keeps the full layout docked only when the chat still gets 820px', () => {
    const needed =
      SIDEBAR_EXPANDED_WIDTH + TREE_PANEL_WIDTH + WORKSPACE_PANEL_WIDTH + CHAT_MAX_WIDTH
    const plan = resolveLayout({ width: needed, ...everythingOpen })
    expect(plan).toEqual({ sidebar: 'expanded', tree: 'static', workspace: 'static' })

    const squeezed = resolveLayout({ width: needed - 1, ...everythingOpen })
    expect(squeezed.sidebar).toBe('expanded')
    // The tree yields first; the workspace panel still fits once it does.
    expect(squeezed).toEqual({ sidebar: 'expanded', tree: 'overlay', workspace: 'static' })
  })

  it('overlays both side columns at 1366px so the chat keeps its measure', () => {
    const plan = resolveLayout({ width: 1366, ...everythingOpen })
    expect(plan).toEqual({ sidebar: 'expanded', tree: 'overlay', workspace: 'overlay' })
  })

  it('drops the sidebar to its rail rather than stranding the chat', () => {
    const plan = resolveLayout({
      width: SIDEBAR_EXPANDED_WIDTH + MIN_CHAT_WIDTH - 1,
      sidebarPinned: true,
      treeOpen: false,
      workspaceOpen: false
    })
    expect(plan.sidebar).toBe('rail')
    // The rail fits the panel comfortably.
    expect(
      resolveLayout({
        width: SIDEBAR_EXPANDED_WIDTH + TREE_PANEL_WIDTH + CHAT_MAX_WIDTH,
        sidebarPinned: true,
        treeOpen: true,
        workspaceOpen: false
      }).tree
    ).toBe('static')
  })

  it('never expands the sidebar when the user collapsed it', () => {
    const plan = resolveLayout({ ...everythingOpen, width: 3840, sidebarPinned: false })
    expect(plan.sidebar).toBe('rail')
  })

  it('leaves closed panels out of the plan', () => {
    expect(
      resolveLayout({ width: 1366, sidebarPinned: true, treeOpen: false, workspaceOpen: false })
    ).toEqual({ sidebar: 'expanded', tree: 'overlay', workspace: 'overlay' })
  })
})
