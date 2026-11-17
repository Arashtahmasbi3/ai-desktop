import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Persistence, type SecretCipher } from '../../src/core/agent/persistence'
import { ToolingAssembler } from '../../src/main/agent-service/tooling'
import type { VpsExecResult } from '../../src/shared/vps'

/*
 * F12: the end-to-end shape of the defect that took three days to find.
 *
 * Every bug in this class - no remote tools because the project had a server, a header selection ignored unless the task
 * said "vps" in English, a run bound to a disconnected project server - lived in the composition between the project, the
 * selected server and the toolset. Unit tests of each piece passed while the seams between them were wrong, so this test
 * goes through the real assembler with a real Persistence and a fake host, and asserts the three things a run needs:
 * the remote tools exist, the run is bound to the right server, and a Persian task does not change either.
 */
const cipher: SecretCipher = {
  encrypt: async (plaintext) => `enc:${plaintext}`,
  decrypt: async (ciphertext) => ciphertext.replace(/^enc:/, '')
}

/**
 * The smallest host the assembler accepts: two servers, one of them connected, and no SSH anywhere.
 *
 * `listServers` is deliberately absent - it is optional, and its absence proves the toolset does not depend on the roster to
 * decide whether remote work is possible. `listFiles` is a function so the SFTP branch (which is where remote_copy is
 * registered) is taken.
 */
function fakeHost(connected: readonly string[]): {
  calls: string[]
  connectedServers: () => string[]
  exec: (serverId: string, command: string) => Promise<VpsExecResult>
  readFile: () => Promise<string>
  writeFile: () => Promise<void>
  listFiles: () => Promise<never[]>
} {
  const calls: string[] = []
  return {
    calls,
    connectedServers: () => [...connected],
    exec: async (serverId, command) => {
      calls.push(serverId + ':' + command)
      return { ok: true, stdout: '', stderr: '', exitCode: 0 }
    },
    readFile: async () => 'remote content',
    writeFile: async () => undefined,
    listFiles: async () => []
  }
}

interface SettingsFile {
  activeProjectId: string
  projectVpsId: string
}

let dir: string
let persistence: Persistence

async function seed(settings: SettingsFile): Promise<void> {
  await writeFile(
    join(dir, 'settings.json'),
    JSON.stringify({
      version: 4,
      providers: {},
      updatedAt: 1,
      activeProjectId: settings.activeProjectId,
      projects: [
        {
          id: 'p1',
          name: 'Project',
          path: '/opt/project',
          type: 'remote',
          vpsId: settings.projectVpsId
        }
      ]
    })
  )
  persistence = new Persistence({ file: join(dir, 'settings.json'), cipher })
  await persistence.load()
}

function assemblerFor(host: ReturnType<typeof fakeHost>): ToolingAssembler {
  return new ToolingAssembler({
    persistence,
    now: () => 0,
    userDataDir: join(dir, 'user-data'),
    vps: host,
    mcpConnect: async () => {
      throw new Error('no MCP server is configured in this test')
    }
  })
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'remote-runtime-e2e-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('a run that should work on a server', () => {
  it('offers the remote tools even though the project has a server of its own', async () => {
    // The project sits on s1; the chat header picks s2, which is the connected one.
    await seed({ activeProjectId: 'p1', projectVpsId: 's1' })
    const runtime = await assemblerFor(fakeHost(['s2'])).buildRemoteRuntime('یک فایل را منتقل کن', 's2')

    const names = (runtime.extraTools ?? []).map((definition) => definition.name)
    /*
     * The old code returned here with a hint and the MCP/skills groups only, because the project had a vpsId. No
     * remote_shell existed for the model, and the run was bound to the project's server regardless of the selection.
     */
    expect(names).toContain('remote_shell')
    expect(names).toContain('remote_copy')
    expect(runtime.serverId).toBe('s2')
  })

  it('keeps a Persian task on the remote path', async () => {
    await seed({ activeProjectId: 'p1', projectVpsId: 's1' })
    const host = fakeHost(['s1', 's2'])
    // No English keyword anywhere: the decision must not depend on the wording.
    const runtime = await assemblerFor(host).buildRemoteRuntime('این فایل را روی سرور بساز', undefined)

    expect((runtime.extraTools ?? []).map((definition) => definition.name)).toContain('remote_shell')
    expect(runtime.serverId).toBe('s1')
  })

  it('falls back to the project server when the selected one is down', async () => {
    await seed({ activeProjectId: 'p1', projectVpsId: 's1' })
    const runtime = await assemblerFor(fakeHost(['s1'])).buildRemoteRuntime('copy this', 's2')

    // s2 was requested but is not connected, so the project's live server wins - and it is still usable.
    expect(runtime.serverId).toBe('s1')
    expect((runtime.extraTools ?? []).map((definition) => definition.name)).toContain('remote_shell')
  })

  it('does not invent a server when none is selected or connected', async () => {
    await seed({ activeProjectId: 'p1', projectVpsId: 's1' })
    const runtime = await assemblerFor(fakeHost([])).buildRemoteRuntime('سلام', undefined)

    expect(runtime.serverId).toBeDefined()
    expect((runtime.extraTools ?? []).map((definition) => definition.name)).not.toContain('remote_shell')
  })
})
