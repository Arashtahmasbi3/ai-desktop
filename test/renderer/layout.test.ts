/**
 * v2.6.3 Topic 1 - layout math. At 1366px an expanded sidebar + docked file tree +
 * docked workspace panel used to leave the chat ~500px; the rules below keep the
 * conversation at its comfortable measure by overlaying columns that do not fit.
 *
 * The sidebar has two controls: `sidebarCollapsed` (Ctrl+B) always wins and forces
 * the rail; `sidebarPinned` keeps it expanded down to MIN_CHAT_WIDTH, while an
 * unpinned sidebar only stays expanded when the chat can reach CHAT_DOCK_FLOOR, while CHAT_MAX_WIDTH caps how wide the
 * conversation itself grows.
 */
import { describe, expect, it } from 'vitest'
import {
  CHAT_DOCK_FLOOR,
  CHAT_MAX_WIDTH,
  MIN_CHAT_WIDTH,
  SIDEBAR_EXPANDED_WIDTH,
  TREE_PANEL_WIDTH,
  WORKSPACE_PANEL_WIDTH,
  resolveLayout
} from '../../src/renderer/src/lib/layout'

const everythingOpen = {
  sidebarPinned: true,
  sidebarCollapsed: false,
  treeOpen: true,
  workspaceOpen: true
}

describe('resolveLayout', () => {
  it('keeps the full layout docked only when the chat still gets 820px', () => {
    // The floor is what a docked column must leave; the cap only limits how wide the text grows.
    const needed =
      SIDEBAR_EXPANDED_WIDTH + TREE_PANEL_WIDTH + WORKSPACE_PANEL_WIDTH + CHAT_DOCK_FLOOR
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
      sidebarCollapsed: false,
      treeOpen: false,
      workspaceOpen: false
    })
    expect(plan.sidebar).toBe('rail')
    // The rail fits the panel comfortably.
    expect(
      resolveLayout({
        width: SIDEBAR_EXPANDED_WIDTH + TREE_PANEL_WIDTH + CHAT_MAX_WIDTH,
        sidebarPinned: true,
        sidebarCollapsed: false,
        treeOpen: true,
        workspaceOpen: false
      }).tree
    ).toBe('static')
  })

  it('never expands the sidebar when the user collapsed it', () => {
    const plan = resolveLayout({ ...everythingOpen, width: 3840, sidebarCollapsed: true })
    expect(plan.sidebar).toBe('rail')
  })

  it('lets an unpinned sidebar fall to the rail when the chat cannot reach 820px', () => {
    // 1000px: pinned keeps the chat above its 560 minimum (expanded), but the
    // unpinned sidebar yields so the chat can claim its full 820 measure.
    const width = 1000
    expect(resolveLayout({ width, ...everythingOpen }).sidebar).toBe('expanded')
    expect(resolveLayout({ width, ...everythingOpen, sidebarPinned: false }).sidebar).toBe('rail')
    // Past the unpinned threshold both pin states agree again.
    expect(
      resolveLayout({
        width: SIDEBAR_EXPANDED_WIDTH + CHAT_MAX_WIDTH,
        ...everythingOpen,
        sidebarPinned: false
      }).sidebar
    ).toBe('expanded')
  })

  it('leaves closed panels out of the plan', () => {
    expect(
      resolveLayout({
        width: 1366,
        sidebarPinned: true,
        sidebarCollapsed: false,
        treeOpen: false,
        workspaceOpen: false
      })
    ).toEqual({ sidebar: 'expanded', tree: 'overlay', workspace: 'overlay' })
  })
})
