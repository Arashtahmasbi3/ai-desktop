import { describe, it, expect } from 'vitest'
import type { VpsExecResult } from '@shared/vps'
import {
  NO_VPS_SELECTED_MESSAGE,
  reconcileRunServer,
  requiresVps,
  resolveVpsForRun,
  VPS_REQUIRING_TOOLS
} from '@core/agent/vps-resolver'
import { planRemoteRuntime, type RemoteShellHost } from '../../src/main/agent-service'

/**
 * P0-4: a run must never auto-bind to `connectedServers()[0]` just because the
 * prompt mentioned a VPS. Resolution is explicit (chat header) or from the
 * active remote project; otherwise a VPS-requiring run fails closed.
 */

function fakeHost(connected: string[]): RemoteShellHost {
  return {
    connectedServers: () => connected,
    exec: async (): Promise<VpsExecResult> => ({
      ok: true,
      stdout: '',
      stderr: '',
      exitCode: 0
    })
  }
}

describe('requiresVps', () => {
  it('marks every remote / migration / per-project tool as VPS-requiring', () => {
    for (const tool of VPS_REQUIRING_TOOLS) {
      expect(requiresVps(tool)).toBe(true)
    }
  })

  it('does not require a VPS for local file tools', () => {
    expect(requiresVps('read_file')).toBe(false)
    expect(requiresVps('write_file')).toBe(false)
    expect(requiresVps('run_command')).toBe(false)
    expect(requiresVps('list_dir')).toBe(false)
  })
})

describe('resolveVpsForRun', () => {
  it('prefers an explicit selection above everything else', () => {
    const result = resolveVpsForRun({
      explicitVpsId: 'srv-explicit',
      project: { type: 'remote', vpsId: 'srv-project' },
      requiresVps: true
    })
    expect(result).toEqual({ ok: true, vpsId: 'srv-explicit', source: 'explicit' })
  })

  it("falls back to a remote project's own VPS", () => {
    const result = resolveVpsForRun({
      project: { type: 'remote', vpsId: 'srv-project' },
      requiresVps: true
    })
    expect(result).toEqual({ ok: true, vpsId: 'srv-project', source: 'project' })
  })

  it('ignores a local project (no VPS source)', () => {
    const result = resolveVpsForRun({
      project: { type: 'local', vpsId: 'should-not-be-used' },
      requiresVps: false
    })
    expect(result).toEqual({ ok: true, source: 'none' })
  })

  it('fails closed when a VPS is required but nothing is selected', () => {
    const result = resolveVpsForRun({ requiresVps: true })
    expect(result.ok).toBe(false)
    expect(result.vpsId).toBeUndefined()
    expect(result.error).toBe(NO_VPS_SELECTED_MESSAGE)
    expect(result.source).toBe('none')
  })

  it('allows a local run that does not require a VPS', () => {
    const result = resolveVpsForRun({ requiresVps: false })
    expect(result).toEqual({ ok: true, source: 'none' })
  })

  it('ignores a remote project with no vpsId and fails closed when required', () => {
    const result = resolveVpsForRun({
      project: { type: 'remote' },
      requiresVps: true
    })
    expect(result.ok).toBe(false)
  })
})

describe('planRemoteRuntime never auto-selects a VPS (P0-4)', () => {
  it('does not pick the first of several connected hosts from a keyword', () => {
    const runtime = planRemoteRuntime(
      'run this on my vps server',
      undefined,
      fakeHost(['srv-1', 'srv-2', 'srv-3'])
    )
    expect(runtime.extraTools).toBeUndefined()
    expect(runtime.extraExecutor).toBeUndefined()
    expect(runtime.systemHint).toMatch(/choose a VPS/i)
  })

  it('never silently targets a host even when exactly one is connected', () => {
    const runtime = planRemoteRuntime('deploy over ssh', undefined, fakeHost(['only-host']))
    expect(runtime.extraTools).toBeUndefined()
    expect(runtime.systemHint ?? '').not.toContain('only-host')
  })

  it('does not auto-select for a VPS-only tool group without a selection', () => {
    const runtime = planRemoteRuntime('do work', undefined, fakeHost(['srv-1']), undefined, [
      'project_user',
      'worktree_manager',
      'migrate_database'
    ])
    expect(runtime.extraTools).toBeUndefined()
    expect(runtime.systemHint).toMatch(/choose a VPS/i)
  })

  it('does not offer VPS tools when the connection is down', () => {
    const runtime = planRemoteRuntime('do work', 'srv-1', fakeHost([]), undefined, ['worktree_create'])
    expect(runtime.extraTools).toBeUndefined()
    expect(runtime.systemHint).toMatch(/not connected/i)
  })

  it('still offers VPS tools once the user explicitly selects a connected host', () => {
    const runtime = planRemoteRuntime('do work', 'srv-2', fakeHost(['srv-1', 'srv-2']))
    expect(runtime.extraTools?.map((tool) => tool.name)).toContain('remote_shell')
    expect(runtime.systemHint).toContain('srv-2')
  })
})

/**
 * v2.6.4 - the run's routing decision and its tool runtime must target the same
 * host. A stale chat-header selection that is no longer connected must fall back
 * to the active project's server instead of splitting the two.
 */
describe('v2.6.4 - reconcileRunServer', () => {
  it('keeps an explicit, connected header selection', () => {
    const run = reconcileRunServer({
      requestedVpsId: 'srv-phone',
      projectVpsId: 'srv-proj',
      connectedServers: ['srv-phone', 'srv-proj']
    })
    expect(run).toEqual({ serverId: 'srv-phone', connected: true, reconciled: false })
    expect(run.warning).toBeUndefined()
  })

  it('falls back to the project server when the header selection is not connected', () => {
    const run = reconcileRunServer({
      requestedVpsId: 'srv-stale',
      projectVpsId: 'srv-proj',
      connectedServers: ['srv-proj']
    })
    expect(run).toMatchObject({ serverId: 'srv-proj', connected: true, reconciled: true })
    // B-11: the swap is no longer silent.
    expect(run.warning).toBe(
      'Requested VPS "srv-stale" is not connected; using the project\'s server "srv-proj" instead.'
    )
  })

  it('uses the project server when there is no explicit selection', () => {
    const run = reconcileRunServer({
      projectVpsId: 'srv-proj',
      connectedServers: ['srv-proj']
    })
    expect(run).toEqual({ serverId: 'srv-proj', connected: true, reconciled: false })
  })

  it('reports not-connected when neither the request nor the project host is up', () => {
    const run = reconcileRunServer({
      requestedVpsId: 'srv-stale',
      projectVpsId: 'srv-proj',
      connectedServers: []
    })
    expect(run).toMatchObject({ serverId: 'srv-proj', connected: false, reconciled: true })
    expect(run.warning).toContain('"srv-stale" is not connected')
    expect(run.warning).toContain('"srv-proj"')
  })

  it('is a local, unconnected run when nothing is selected or connected', () => {
    const run = reconcileRunServer({ connectedServers: ['srv-other'] })
    expect(run).toEqual({ serverId: undefined, connected: false, reconciled: false })
  })

  it('B-11: explains a dropped header selection even when it leaves no server', () => {
    const run = reconcileRunServer({ requestedVpsId: 'srv-stale', connectedServers: [] })
    expect(run).toMatchObject({ serverId: undefined, connected: false, reconciled: true })
    expect(run.warning).toBe(
      'Requested VPS "srv-stale" is not connected; continuing without a VPS.'
    )
  })
})
