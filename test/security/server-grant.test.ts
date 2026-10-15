import { describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import {
  SERVER_GRANT_TTL_MS,
  createServerGrant,
  isServerGrantValid,
  parseServerGrants
} from '../../src/core/agent/server-grant'
import { ApprovedCommands } from '../../src/core/agent/approved-commands'
import { createApprovalGate } from '../../src/main/approval-gate'
import type { AgentAction } from '../../src/shared/agent'

/**
 * v2.8.1 — "approve every command on this server in this project for 30 minutes".
 *
 * The read-only classifier covers provably-read work, but a user doing real shell work on
 * their own VPS still gets one dialog per command and cannot suppress them at all: the v2.5
 * hardening deliberately made shell/write tools non-rememberable. This is the escape hatch,
 * and these tests pin how narrow it is.
 */
const VPS = '34c80099-2868-40a1-bef4-9b23d865db0b'
const PROJECT = 'p1'
const OTHER_VPS = 'aaaa1111-2222-3333-4444-555566667777'

describe('server grant validity (v2.8.1)', () => {
  it('is valid only for its own server and project', () => {
    const grant = createServerGrant(VPS, PROJECT, { now: 1000 })
    expect(isServerGrantValid(grant, { vpsId: VPS, projectId: PROJECT }, 1000)).toBe(true)
    expect(isServerGrantValid(grant, { vpsId: OTHER_VPS, projectId: PROJECT }, 1000)).toBe(false)
    expect(isServerGrantValid(grant, { vpsId: VPS, projectId: 'p2' }, 1000)).toBe(false)
  })

  it('expires, and is evaluated against the clock it is given', () => {
    const grant = createServerGrant(VPS, PROJECT, { now: 1000 })
    expect(grant.expiresAt).toBe(1000 + SERVER_GRANT_TTL_MS)
    expect(isServerGrantValid(grant, { vpsId: VPS, projectId: PROJECT }, 1000 + SERVER_GRANT_TTL_MS - 1)).toBe(true)
    expect(isServerGrantValid(grant, { vpsId: VPS, projectId: PROJECT }, 1000 + SERVER_GRANT_TTL_MS)).toBe(false)
  })

  it('fails closed on an empty scope, so a remote grant can never cover a local run', () => {
    const grant = createServerGrant(VPS, PROJECT, { now: 1000 })
    expect(isServerGrantValid(grant, { vpsId: '', projectId: PROJECT }, 1000)).toBe(false)
    expect(isServerGrantValid(grant, { vpsId: VPS, projectId: '' }, 1000)).toBe(false)
    // A grant with no server recorded is inert.
    expect(
      isServerGrantValid({ ...grant, vpsId: '' }, { vpsId: '', projectId: PROJECT }, 1000)
    ).toBe(false)
  })

  it('drops unparseable entries from disk', () => {
    expect(parseServerGrants(null)).toEqual([])
    expect(parseServerGrants([{ id: 'x' }, { id: 'y', vpsId: 'v', projectId: 'p' }])).toEqual([])
    expect(
      parseServerGrants([{ id: 'z', vpsId: 'v', projectId: 'p', createdAt: 1, expiresAt: 2 }])
    ).toHaveLength(1)
  })
})

describe('ApprovedCommands server grants (v2.8.1)', () => {
  async function withStore<T>(run: (store: ApprovedCommands, file: string) => Promise<T>): Promise<T> {
    const dir = await mkdtemp(join(tmpdir(), 'ai-desktop-grants-'))
    const file = join(dir, 'approved-commands.json')
    try {
      return await run(new ApprovedCommands({ file }), file)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }

  it('mints, reports and revokes a grant', async () => {
    await withStore(async (store, file) => {
      await store.load()
      expect(store.isServerGranted({ vpsId: VPS, projectId: PROJECT })).toBe(false)

      const grant = await store.rememberServerGrant(VPS, PROJECT, { now: 1000 })
      expect(store.isServerGranted({ vpsId: VPS, projectId: PROJECT }, 1000)).toBe(true)
      expect(store.isServerGranted({ vpsId: OTHER_VPS, projectId: PROJECT }, 1000)).toBe(false)

      // It is visible in the list (so it can be seen and revoked) while it is live…
      const listed = store.list(1000)
      expect(listed.some((view) => view.kind === 'server' && view.id === grant.id)).toBe(true)
      // …and hidden once it has expired, without any renderer timer involved.
      expect(store.list(1000 + SERVER_GRANT_TTL_MS)).toHaveLength(0)

      // Persisted across a reload, and revocation is by the grant's own id.
      const reloaded = new ApprovedCommands({ file })
      await reloaded.load()
      expect(reloaded.isServerGranted({ vpsId: VPS, projectId: PROJECT }, 1000)).toBe(true)
      expect(await reloaded.revoke(grant.id)).toBe(true)
      expect(reloaded.isServerGranted({ vpsId: VPS, projectId: PROJECT }, 1000)).toBe(false)
    })
  })

  it('replaces an existing grant for the same scope instead of stacking them', async () => {
    await withStore(async (store) => {
      await store.load()
      await store.rememberServerGrant(VPS, PROJECT, { now: 1000, id: 'server:first' })
      await store.rememberServerGrant(VPS, PROJECT, { now: 2000, id: 'server:second' })
      expect(store.list(2000).filter((view) => view.kind === 'server')).toHaveLength(1)
      expect(store.serverGrantFor({ vpsId: VPS, projectId: PROJECT }, 2000)?.id).toBe('server:second')
    })
  })

  it('refuses a grant with no server or no project', async () => {
    await withStore(async (store) => {
      await store.load()
      await expect(store.rememberServerGrant('', PROJECT)).rejects.toThrow()
      await expect(store.rememberServerGrant(VPS, '')).rejects.toThrow()
    })
  })

  it('never puts a grant into the permanent allow lists', async () => {
    await withStore(async (store, file) => {
      await store.load()
      await store.rememberServerGrant(VPS, PROJECT, { now: 1000 })
      const raw = JSON.parse(await fs.readFile(file, 'utf8')) as Record<string, unknown>
      expect(raw.serverGrants).toHaveLength(1)
      // A permanent shell allow is exactly what v2.5 P0-3 removed.
      expect(raw.tools).toEqual([])
      expect(raw.always).toEqual([])
      expect(raw.sessions).toEqual({})
    })
  })
})

function action(name: string, args: Record<string, unknown>): AgentAction {
  return {
    id: 'a1',
    name,
    arguments: args,
    rawArguments: JSON.stringify(args),
    valid: true,
    signature: `${name}:test`
  }
}

describe('the gate honours a server grant (v2.8.1)', () => {
  async function gateWith(approvedCommands: ApprovedCommands) {
    const asked = vi.fn(async () => ({ approved: true }))
    const gate = createApprovalGate({
      mode: 'auto-write',
      vpsId: VPS,
      projectId: PROJECT,
      approvedCommands,
      requestApproval: asked
    })
    return { gate, asked }
  }

  it('stops asking for shell commands once the user grants the window', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ai-desktop-gate-grant-'))
    try {
      const store = new ApprovedCommands({ file: join(dir, 'approved-commands.json') })
      await store.load()

      // First: nobody has granted anything, so a write command prompts.
      const first = createApprovalGate({
        mode: 'auto-write',
        vpsId: VPS,
        projectId: PROJECT,
        approvedCommands: store,
        requestApproval: async () => ({ approved: true, grant: 'server' })
      })
      expect(await first(action('remote_shell', { command: 'npm run build' }))).toBe(true)
      expect(store.isServerGranted({ vpsId: VPS, projectId: PROJECT })).toBe(true)

      // Second: the same scope is now covered, so the prompt never fires again.
      const second = await gateWith(store)
      expect(await second.gate(action('remote_shell', { command: 'npm run deploy' }))).toBe(true)
      expect(second.asked).not.toHaveBeenCalled()

      // A different server still asks.
      const otherServer = createApprovalGate({
        mode: 'auto-write',
        vpsId: OTHER_VPS,
        projectId: PROJECT,
        approvedCommands: store,
        requestApproval: async () => ({ approved: false })
      })
      expect(await otherServer(action('remote_shell', { command: 'rm -rf /srv' }))).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('still prompts for a deny-listed command even under an active grant', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ai-desktop-gate-deny-'))
    try {
      const store = new ApprovedCommands({ file: join(dir, 'approved-commands.json') })
      await store.load()
      await store.rememberServerGrant(VPS, PROJECT)

      const asked = vi.fn(async () => ({ approved: false }))
      const gate = createApprovalGate({
        mode: 'auto-write',
        vpsId: VPS,
        projectId: PROJECT,
        approvedCommands: store,
        requestApproval: asked
      })

      // The grant sits inside `if (!denyListed)`, so the deny list still wins.
      expect(await gate(action('remote_shell', { command: 'rm -rf /' }))).toBe(false)
      expect(asked).toHaveBeenCalled()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
