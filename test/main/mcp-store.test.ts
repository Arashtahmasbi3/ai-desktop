import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { McpServerStore } from '../../src/main/mcp/store'
import { XorCipher } from '../helpers/fake-cipher'

/**
 * v4.3.17 — SEC-5.
 *
 * An MCP server's `env` block is where a token lives (`GITHUB_PERSONAL_ACCESS_TOKEN=ghp_…`), and the store's own
 * comment says so — yet it was written to `mcp.json` in cleartext while provider keys, SSH passwords and the GitHub
 * token all went through `SecretCipher`.
 */
const cipher = new XorCipher()

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mcp-store-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('an MCP env token is never written in cleartext (v4.3.17)', () => {
  it('stores the value encrypted and returns it decrypted to main', async () => {
    const store = new McpServerStore({ baseDir: dir, cipher })
    await store.save({
      name: 'github',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_super_secret' }
    })

    const raw = await readFile(join(dir, 'mcp.json'), 'utf8')
    expect(raw).not.toContain('ghp_super_secret')
    expect(raw).toContain('envEnc')

    const [server] = await store.list()
    expect(server?.env).toEqual({ GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_super_secret' })
  })

  it('re-encrypts a file written by an older build, so the plaintext does not survive the upgrade', async () => {
    const legacy = {
      version: 1,
      servers: [
        {
          id: 'mcp-old',
          name: 'old',
          command: 'npx',
          args: [],
          env: { API_TOKEN: 'legacy-plaintext' },
          enabled: true,
          createdAt: 1
        }
      ]
    }
    await writeFile(join(dir, 'mcp.json'), JSON.stringify(legacy), 'utf8')

    const store = new McpServerStore({ baseDir: dir, cipher })
    const [server] = await store.list()
    expect(server?.env).toEqual({ API_TOKEN: 'legacy-plaintext' })

    const raw = await readFile(join(dir, 'mcp.json'), 'utf8')
    expect(raw).not.toContain('legacy-plaintext')
    expect(raw).toContain('envEnc')
  })

  it('still round-trips a server with no environment', async () => {
    const store = new McpServerStore({ baseDir: dir, cipher })
    await store.save({ name: 'plain', command: 'node', args: ['server.js'] })
    const [server] = await store.list()
    expect(server).toMatchObject({ name: 'plain', command: 'node' })
    expect(server?.env).toBeUndefined()
  })

  it('keeps a value it cannot decrypt out of the returned config instead of failing the list', async () => {
    await writeFile(
      join(dir, 'mcp.json'),
      JSON.stringify({
        version: 1,
        servers: [
          {
            id: 'mcp-bad',
            name: 'bad',
            command: 'node',
            args: [],
            envEnc: { TOKEN: 'not-ciphertext' },
            enabled: true,
            createdAt: 1
          }
        ]
      }),
      'utf8'
    )
    const store = new McpServerStore({ baseDir: dir, cipher })
    const [server] = await store.list()
    expect(server?.id).toBe('mcp-bad')
    expect(server?.env).toBeUndefined()
  })
})
