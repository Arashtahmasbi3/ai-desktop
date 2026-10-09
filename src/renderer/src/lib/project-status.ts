/**
 * Derive the warning banner shown above the chat for the active project.
 *
 * A remote project must never be reported as "Path not found": its folder lives
 * on a VPS, not on this machine. This pure function maps (project kind, VPS
 * connection, path) onto exactly one of the states in the v2.3.2 A.2 table, so
 * the UI can pick the right message, tone and action without guessing.
 */

export type WorkspaceStatusKind =
  | 'none'
  | 'local-ok'
  | 'local-missing'
  | 'remote-ok'
  | 'remote-disconnected'
  | 'remote-no-vps'
  | 'remote-no-path'

export type WorkspaceTone = 'ok' | 'warning' | 'error'

export type WorkspaceAction = 'none' | 'picker' | 'settings' | 'reconnect'

export interface WorkspaceStatus {
  kind: WorkspaceStatusKind
  tone: WorkspaceTone
  /** i18n key for the banner text; `null` means "render nothing". */
  messageKey: string | null
  /** i18n key for the action button; `null` means "no action". */
  actionKey: string | null
  action: WorkspaceAction
  /** Remote path, exposed as the `{{path}}` i18n parameter for `remote-ok`. */
  path?: string
}

export interface WorkspaceStatusInput {
  project?:
    | {
        type?: 'local' | 'remote'
        path?: string
        vpsId?: string
        /** Local projects: whether the folder exists on this machine. */
        exists?: boolean
      }
    | undefined
  /** Whether `project.vpsId` is currently connected. */
  vpsConnected: boolean
}

function ok(kind: 'local-ok'): WorkspaceStatus {
  return { kind, tone: 'ok', messageKey: null, actionKey: null, action: 'none' }
}

/** Map the active project onto the v2.3.2 A.2 status table. */
export function workspaceStatus(input: WorkspaceStatusInput): WorkspaceStatus {
  const project = input.project

  if (!project) {
    return {
      kind: 'none',
      tone: 'warning',
      messageKey: 'chat.noWorkspaceWarning',
      actionKey: 'titlebar.openFolder',
      action: 'picker'
    }
  }

  if (project.type === 'remote') {
    if (!project.vpsId) {
      return {
        kind: 'remote-no-vps',
        tone: 'warning',
        messageKey: 'chat.remoteNoVps',
        actionKey: 'chat.selectVps',
        action: 'settings'
      }
    }
    if (!project.path) {
      return {
        kind: 'remote-no-path',
        tone: 'warning',
        messageKey: 'chat.remoteNoPath',
        actionKey: 'chat.setPath',
        action: 'settings'
      }
    }
    if (!input.vpsConnected) {
      return {
        kind: 'remote-disconnected',
        tone: 'error',
        messageKey: 'chat.remoteDisconnected',
        actionKey: 'chat.reconnect',
        action: 'reconnect'
      }
    }
    return {
      kind: 'remote-ok',
      tone: 'ok',
      messageKey: 'chat.remoteConnected',
      actionKey: null,
      action: 'none',
      path: project.path
    }
  }

  if (project.exists === false) {
    return {
      kind: 'local-missing',
      tone: 'warning',
      messageKey: 'chat.localPathMissing',
      actionKey: 'sidebar.locate',
      action: 'picker'
    }
  }

  return ok('local-ok')
}

/** Whether the derived status should render a banner at all. */
export function shouldShowWorkspaceBanner(status: WorkspaceStatus): boolean {
  return status.messageKey !== null
}
