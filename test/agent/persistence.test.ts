import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  Persistence,
  SETTINGS_SCHEMA_VERSION,
  migrateSettings,
  resolveUserDataDir
} from '@core/agent/persistence'
import { XorCipher } from '../helpers/fake-cipher'

let dir: string
let file: string
const cipher = new XorCipher()

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'agent-persist-'))
  file = join(dir, 'settings.json')
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe('resolveUserDataDir', () => {
  it('uses %APPDATA% on Windows', () => {
    const path = resolveUserDataDir({
      appName: 'AI Desktop',
      platform: 'win32',
      env: { APPDATA: 'C:\\Users\\x\\AppData\\Roaming' }
    })
    expect(path).toBe(join('C:\\Users\\x\\AppData\\Roaming', 'AI Desktop'))
  })

  it('uses Application Support on macOS', () => {
    const path = resolveUserDataDir({
      appName: 'AI Desktop',
      platform: 'darwin',
      home: '/Users/x'
    })
    expect(path).toBe(join('/Users/x', 'Library', 'Application Support', 'AI Desktop'))
  })

  it('uses XDG_CONFIG_HOME (or ~/.config) on Linux', () => {
    expect(
      resolveUserDataDir({ appName: 'ai', platform: 'linux', env: { XDG_CONFIG_HOME: '/cfg' } })
    ).toBe(join('/cfg', 'ai'))
    expect(resolveUserDataDir({ appName: 'ai', platform: 'linux', env: {}, home: '/home/x' })).toBe(
      join('/home/x', '.config', 'ai')
    )
  })
})

describe('Persistence', () => {
  it('encrypts API keys and never writes the plaintext', async () => {
    const store = new Persistence({ file, cipher })
    await store.setApiKey('deepseek', 'sk-super-secret')

    const onDisk = await fs.readFile(file, 'utf8')
    expect(onDisk).not.toContain('sk-super-secret')
    expect(JSON.parse(onDisk).providers.deepseek.apiKeyEnc).toMatch(/^enc:/)

    expect(await store.getApiKey('deepseek')).toBe('sk-super-secret')
  })

  it('reloads encrypted keys from disk', async () => {
    const writer = new Persistence({ file, cipher })
    await writer.setApiKey('deepseek', 'sk-123')

    const reader = new Persistence({ file, cipher })
    expect(await reader.getApiKey('deepseek')).toBe('sk-123')
  })

  it('redacts ciphertext from the UI-facing view', async () => {
    const store = new Persistence({ file, cipher })
    await store.setApiKey('deepseek', 'sk-123')
    await store.setProviderModel('deepseek', 'deepseek-chat')

    const redacted = store.redacted()
    expect(redacted.providers.deepseek).toEqual({ hasApiKey: true, model: 'deepseek-chat' })
    expect(JSON.stringify(redacted)).not.toContain('enc:')
  })

  it('removes a key when set to an empty string', async () => {
    const store = new Persistence({ file, cipher })
    await store.setApiKey('deepseek', 'sk-123')
    await store.setApiKey('deepseek', '')
    expect(await store.getApiKey('deepseek')).toBeUndefined()
  })

  it('adds and removes projects', async () => {
    const store = new Persistence({ file, cipher, idFactory: () => 'p1' })
    const project = await store.addProject('AI Desktop', 'C:\\projects\\ai-desktop')
    expect(project).toEqual({
      id: 'p1',
      name: 'AI Desktop',
      path: 'C:\\projects\\ai-desktop',
      createdAt: expect.any(Number)
    })
    expect(store.listProjects()).toHaveLength(1)

    expect(await store.removeProject('p1')).toBe(true)
    expect(store.listProjects()).toHaveLength(0)
    expect(await store.removeProject('missing')).toBe(false)
  })

  it('starts empty when the file is missing or corrupt', async () => {
    expect((await new Persistence({ file, cipher }).load()).projects).toEqual([])

    await fs.writeFile(file, '{ broken', 'utf8')
    const store = new Persistence({ file, cipher })
    expect((await store.load()).version).toBe(SETTINGS_SCHEMA_VERSION)
    expect(store.listProjects()).toEqual([])
  })

  it('migrates a v0 payload, encrypting the plaintext key', async () => {
    const v0 = {
      provider: 'deepseek',
      apiKey: 'sk-plain',
      model: 'deepseek-chat',
      projects: ['C:\\projects\\legacy']
    }
    await fs.writeFile(file, JSON.stringify(v0), 'utf8')

    const store = new Persistence({ file, cipher })
    await store.load()

    expect(await store.getApiKey('deepseek')).toBe('sk-plain')
    expect(store.getSettings().providers.deepseek?.model).toBe('deepseek-chat')
    expect(store.getSettings().activeProvider).toBe('deepseek')
    expect(store.listProjects()[0]).toMatchObject({
      name: 'C:\\projects\\legacy',
      path: 'C:\\projects\\legacy'
    })

    // The legacy plaintext key is scrubbed from disk by the migration save.
    const onDisk = await fs.readFile(file, 'utf8')
    expect(onDisk).not.toContain('sk-plain')
    expect(JSON.parse(onDisk).version).toBe(SETTINGS_SCHEMA_VERSION)
  })
})

describe('migrateSettings', () => {
  it('returns empty settings for non-objects', async () => {
    const settings = await migrateSettings(null, cipher, 42)
    expect(settings).toEqual({ version: SETTINGS_SCHEMA_VERSION, providers: {}, projects: [], updatedAt: 42 })
  })

  it('keeps a v1 payload intact', async () => {
    const settings = await migrateSettings(
      {
        version: 1,
        activeProvider: 'deepseek',
        providers: { deepseek: { apiKeyEnc: 'enc:abc', model: 'm' } },
        projects: [{ id: 'p', name: 'P', path: '/p', createdAt: 1 }]
      },
      cipher,
      7
    )
    expect(settings.providers.deepseek).toEqual({ apiKeyEnc: 'enc:abc', model: 'm' })
    expect(settings.projects).toHaveLength(1)
    expect(settings.activeProvider).toBe('deepseek')
  })

  it('carries the v2 approval preferences through migration', async () => {
    const settings = await migrateSettings(
      { version: 1, approvalMode: 'writes', planModeDefault: true },
      cipher,
      7
    )
    expect(settings.version).toBe(SETTINGS_SCHEMA_VERSION)
    expect(settings.approvalMode).toBe('writes')
    expect(settings.planModeDefault).toBe(true)
  })

  it('ignores an unknown approval mode', async () => {
    const settings = await migrateSettings({ version: 1, approvalMode: 'yolo' }, cipher, 7)
    expect(settings.approvalMode).toBeUndefined()
  })
})

describe('approval preferences persistence', () => {
  it('round-trips approvalMode and planModeDefault', async () => {
    const store = new Persistence({ file, cipher })
    await store.setApprovalMode('writes')
    await store.setPlanModeDefault(true)

    const reloaded = new Persistence({ file, cipher })
    const settings = await reloaded.load()
    expect(settings.approvalMode).toBe('writes')
    expect(settings.planModeDefault).toBe(true)
    expect(reloaded.redacted()).toMatchObject({ approvalMode: 'writes', planModeDefault: true })
  })
})
