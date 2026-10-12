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

/** Comfortable reading measure for the conversation (v2.6.3 spec). */
export const CHAT_MAX_WIDTH = 820
/** Icon rail width when the sidebar cannot stay expanded. */
export const SIDEBAR_RAIL_WIDTH = 56
/** Expanded sidebar width. */
export const SIDEBAR_EXPANDED_WIDTH = 256
/** Left file-tree column width when it is docked. */
export const TREE_PANEL_WIDTH = 256
/** Right workspace column width when it is docked. */
export const WORKSPACE_PANEL_WIDTH = 352
/** Below this the chat stops feeling like a conversation; panels overlay instead. */
export const MIN_CHAT_WIDTH = 560

export interface LayoutInput {
  /** Viewport width in CSS pixels. */
  width: number
  /** The user explicitly wants the sidebar expanded (i.e. not collapsed via Ctrl+B). */
  sidebarPinned: boolean
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
 */
export function resolveLayout(input: LayoutInput): LayoutPlan {
  const { width, sidebarPinned, treeOpen, workspaceOpen } = input
  const expanded =
    sidebarPinned && width - SIDEBAR_EXPANDED_WIDTH >= MIN_CHAT_WIDTH
  const sidebar = expanded ? SIDEBAR_EXPANDED_WIDTH : SIDEBAR_RAIL_WIDTH

  const treeStatic =
    treeOpen &&
    width - sidebar - TREE_PANEL_WIDTH - (workspaceOpen ? WORKSPACE_PANEL_WIDTH : 0) >=
      CHAT_MAX_WIDTH
  const workspaceStatic =
    workspaceOpen &&
    width - sidebar - (treeStatic ? TREE_PANEL_WIDTH : 0) - WORKSPACE_PANEL_WIDTH >=
      CHAT_MAX_WIDTH

  return {
    sidebar: expanded ? 'expanded' : 'rail',
    tree: treeStatic ? 'static' : 'overlay',
    workspace: workspaceStatic ? 'static' : 'overlay'
  }
}
