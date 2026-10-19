import { describe, it, expect } from 'vitest'
import {
  workspaceStatus,
  shouldShowWorkspaceBanner,
  type WorkspaceStatusInput
} from '../../src/renderer/src/lib/project-status'

const local = (over: Partial<NonNullable<WorkspaceStatusInput['project']>> = {}) => ({
  type: 'local' as const,
  path: 'C:/proj',
  exists: true,
  ...over
})

const remote = (over: Partial<NonNullable<WorkspaceStatusInput['project']>> = {}) => ({
  type: 'remote' as const,
  path: '/opt/app',
  vpsId: 'srv-1',
  ...over
})

describe('workspaceStatus (A.2 table)', () => {
  it('local project that exists shows no banner', () => {
    const status = workspaceStatus({ project: local(), vpsConnected: false })
    expect(status.kind).toBe('local-ok')
    expect(shouldShowWorkspaceBanner(status)).toBe(false)
  })

  it('missing local project asks to locate it', () => {
    const status = workspaceStatus({
      project: local({ exists: false }),
      vpsConnected: false
    })
    expect(status).toMatchObject({
      kind: 'local-missing',
      tone: 'warning',
      messageKey: 'chat.localPathMissing',
      action: 'picker'
    })
  })

  it('remote project with a connected VPS shows no banner at all (R6)', () => {
    // The old `Remote: /opt/app (connected)` banner repeated the breadcrumb and the bar, and it
    // claimed a live session. A connected remote project is the normal case, not a message.
    const status = workspaceStatus({ project: remote(), vpsConnected: true })
    expect(status).toMatchObject({
      kind: 'remote-ok',
      tone: 'ok',
      messageKey: null,
      action: 'none'
    })
    expect(shouldShowWorkspaceBanner(status)).toBe(false)
  })

  it('remote project never reports a missing path while the VPS is connected', () => {
    const status = workspaceStatus({
      project: remote({ exists: false }),
      vpsConnected: true
    })
    expect(status.kind).toBe('remote-ok')
  })

  it('remote project with a disconnected VPS offers reconnect', () => {
    const status = workspaceStatus({ project: remote(), vpsConnected: false })
    expect(status).toMatchObject({
      kind: 'remote-disconnected',
      tone: 'error',
      messageKey: 'chat.remoteDisconnected',
      action: 'reconnect'
    })
  })

  it('remote project without a VPS asks to select one', () => {
    const status = workspaceStatus({
      project: remote({ vpsId: undefined }),
      vpsConnected: false
    })
    expect(status).toMatchObject({
      kind: 'remote-no-vps',
      tone: 'warning',
      messageKey: 'chat.remoteNoVps',
      action: 'settings'
    })
  })

  it('remote project without a path asks to set it', () => {
    const status = workspaceStatus({
      project: remote({ path: undefined }),
      vpsConnected: true
    })
    expect(status).toMatchObject({
      kind: 'remote-no-path',
      tone: 'warning',
      messageKey: 'chat.remoteNoPath',
      action: 'settings'
    })
  })

  it('no active project shows the workspace warning with a folder picker', () => {
    const status = workspaceStatus({ project: undefined, vpsConnected: false })
    expect(status).toMatchObject({
      kind: 'none',
      messageKey: 'chat.noWorkspaceWarning',
      action: 'picker'
    })
  })
})
