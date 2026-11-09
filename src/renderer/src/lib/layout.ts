/**
 * v2.6.3 Topic 1 - shared layout math.
 *
 * The chat used to be squeezed by static auxiliary columns: at 1366px an expanded
 * sidebar + the file tree + the workspace panel left ~500px for the conversation,
 * which reads as a narrow strip. The conversation now gets first claim on space up
 * to {@link CHAT_MAX_WIDTH}; any column that would push it below that becomes an
 * overlay drawer instead of taking width, and the sidebar drops to its rail when it
 * cannot stay expanded.
 *
 * Pure and dependency-free so the rules can be unit-tested without a DOM.
 */

/** The widest the conversation, its composer and its cards ever get (v4.4, measured client profile). */
export const CHAT_MAX_WIDTH = 1120
/**
 * The narrowest a docked column may leave the conversation. Separate from {@link CHAT_MAX_WIDTH} on purpose: the cap is
 * how wide the text grows, this is the point below which an extra column stops docking and floats instead.
 */
export const CHAT_DOCK_FLOOR = 820
/** Icon rail width when the sidebar cannot stay expanded. */
export const SIDEBAR_RAIL_WIDTH = 52
/** Expanded sidebar width. */
export const SIDEBAR_EXPANDED_WIDTH = 372
/** Left file-tree column width when it is docked. */
export const TREE_PANEL_WIDTH = 256
/** Right workspace column width when it is docked. */
export const WORKSPACE_PANEL_WIDTH = 352
/** Below this the chat stops feeling like a conversation; panels overlay instead. */
export const MIN_CHAT_WIDTH = 560

export interface LayoutInput {
  /** Viewport width in CSS pixels. */
  width: number
  /** The user pinned the sidebar so it should stay expanded when it still fits. */
  sidebarPinned: boolean
  /** The user explicitly collapsed the sidebar (Ctrl+B); this always wins. */
  sidebarCollapsed: boolean
  treeOpen: boolean
  workspaceOpen: boolean
}

export interface LayoutPlan {
  sidebar: 'rail' | 'expanded'
  tree: 'static' | 'overlay'
  workspace: 'static' | 'overlay'
}

/**
 * Decide which columns dock and which overlay for a given viewport. Docked columns
 * are only used when the chat still keeps at least {@link CHAT_MAX_WIDTH}; otherwise
 * the panel floats over the chat.
 *
 * The sidebar has two user controls with distinct meaning:
 * - `sidebarCollapsed` (Ctrl+B) hides it entirely -> always the rail.
 * - `sidebarPinned` keeps it expanded. A pinned sidebar holds its width down to
 *   {@link MIN_CHAT_WIDTH} (the chat may get narrow, but not unusably so); an
 *   unpinned (auto) sidebar only stays expanded while the chat can claim its full
 *   {@link CHAT_MAX_WIDTH} measure, so a mid-size window favors the conversation.
 */
export function resolveLayout(input: LayoutInput): LayoutPlan {
  const { width, sidebarPinned, sidebarCollapsed, treeOpen, workspaceOpen } = input

  const sidebarFloor = sidebarPinned ? MIN_CHAT_WIDTH : CHAT_DOCK_FLOOR
  const expanded = !sidebarCollapsed && width - SIDEBAR_EXPANDED_WIDTH >= sidebarFloor
  const sidebar = expanded ? SIDEBAR_EXPANDED_WIDTH : SIDEBAR_RAIL_WIDTH

  const treeStatic =
    treeOpen &&
    width - sidebar - TREE_PANEL_WIDTH - (workspaceOpen ? WORKSPACE_PANEL_WIDTH : 0) >=
      CHAT_DOCK_FLOOR
  const workspaceStatic =
    workspaceOpen &&
    width - sidebar - (treeStatic ? TREE_PANEL_WIDTH : 0) - WORKSPACE_PANEL_WIDTH >=
      CHAT_DOCK_FLOOR

  return {
    sidebar: expanded ? 'expanded' : 'rail',
    tree: treeStatic ? 'static' : 'overlay',
    workspace: workspaceStatic ? 'static' : 'overlay'
  }
}
