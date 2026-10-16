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
    // v3.1: the view gained `keyCount` (how many keys the provider has, never which).
    expect(redacted.providers.deepseek).toEqual({
      hasApiKey: true,
      keyCount: 1,
      model: 'deepseek-chat'
    })
    expect(JSON.stringify(redacted)).not.toContain('enc:')
  })

  it('counts several keys without ever exposing one (v3.1)', async () => {
    const store = new Persistence({ file, cipher })
    await store.setApiKey('deepseek', 'sk-first-secret-value')
    await store.addApiKey('deepseek', 'sk-second-secret-value')

    const redacted = store.redacted()
    expect(redacted.providers.deepseek?.keyCount).toBe(2)
    expect(redacted.providers.deepseek?.hasApiKey).toBe(true)

    // The whole point of a redacted view: neither the keys nor their ciphertext appear anywhere.
    const serialised = JSON.stringify(redacted)
    expect(serialised).not.toContain('sk-first-secret-value')
    expect(serialised).not.toContain('sk-second-secret-value')
    expect(serialised).not.toContain('enc:')
  })

  it('still reads a settings file written by v3.0, which knew only one key (v3.1)', async () => {
    /*
     * The migration guarantee: an existing install's settings.json has `apiKeyEnc` and no
     * `apiKeysEnc`. Upgrading must not lose a credential, so the file below is written by hand in
     * the old shape rather than through the new API — writing it through the new API would test
     * nothing about upgrades, which is exactly the kind of test that passes while the app breaks.
     */
    const encrypted = await cipher.encrypt('sk-from-an-older-version')
    await fs.writeFile(
      file,
      JSON.stringify({
        version: SETTINGS_SCHEMA_VERSION,
        activeProvider: 'deepseek',
        providers: { deepseek: { apiKeyEnc: encrypted, model: 'deepseek-chat' } }
      }),
      'utf8'
    )

    const store = new Persistence({ file, cipher })

    expect(await store.getApiKeys('deepseek')).toEqual(['sk-from-an-older-version'])
    expect(await store.getApiKey('deepseek')).toBe('sk-from-an-older-version')
    expect(store.redacted().providers.deepseek).toMatchObject({ hasApiKey: true, keyCount: 0 })

    // And adding a second key upgrades the file without dropping the first.
    await store.addApiKey('deepseek', 'sk-newly-added')
    expect(await store.getApiKeys('deepseek')).toEqual([
      'sk-from-an-older-version',
      'sk-newly-added'
    ])
    expect(store.redacted().providers.deepseek?.keyCount).toBe(2)
  })

  it('skips an undecryptable key instead of losing the whole provider (v3.1)', async () => {
    // A corrupted entry must not make a working credential unusable.
    const good = await cipher.encrypt('sk-still-good')
    await fs.writeFile(
      file,
      JSON.stringify({
        version: SETTINGS_SCHEMA_VERSION,
        providers: { deepseek: { apiKeysEnc: ['not-a-ciphertext-at-all', good] } }
      }),
      'utf8'
    )

    const store = new Persistence({ file, cipher })
    expect(await store.getApiKeys('deepseek')).toEqual(['sk-still-good'])
  })

  it('resolves both an old single-key file and a new pool file (v3.1)', async () => {
    const store = new Persistence({ file, cipher })
    await store.setApiKeys('deepseek', ['sk-a-value', 'sk-b-value'])

    expect(await store.getApiKeys('deepseek')).toHaveLength(2)
    // `getApiKey` is the first of the pool, so older callers keep working unchanged.
    expect(await store.getApiKey('deepseek')).toBe('sk-a-value')

    /*
     * A restarted app: a brand-new instance reading the same file. This is the assertion that
     * matters, because the migration step drops fields it does not know — and dropping
     * `apiKeysEnc` silently lost every key after the first until the test above caught it.
     */
    const restarted = new Persistence({ file, cipher })
    expect(await restarted.getApiKeys('deepseek')).toEqual(['sk-a-value', 'sk-b-value'])

    await store.removeApiKeyAt('deepseek', 0)
    expect(await store.getApiKeys('deepseek')).toEqual(['sk-b-value'])
    // Removing the last key clears both fields, so `hasApiKey` cannot stay true on an empty pool.
    await store.removeApiKeyAt('deepseek', 0)
    expect(await store.getApiKeys('deepseek')).toEqual([])
    expect(store.redacted().providers.deepseek?.hasApiKey).toBe(false)
    expect(store.redacted().providers.deepseek?.keyCount).toBe(0)
  })

  it('defaults decision checkpoints to off and round-trips a real mode (v3.1)', async () => {
    const store = new Persistence({ file, cipher })

    // Off by default: a log nothing reads and prompts nobody asked for are not features.
    expect(await store.getCheckpointMode()).toBe('off')

    await store.setCheckpointMode('confirm')
    expect(await store.getCheckpointMode()).toBe('confirm')

    // A restart keeps the choice — and keeps it for a *new* instance, not just this one.
    const restarted = new Persistence({ file, cipher })
    expect(await restarted.getCheckpointMode()).toBe('confirm')

    // Turning it off clears the field rather than storing a no-op, so a file that never opted in
    // stays byte-identical to one written before this feature existed.
    await store.setCheckpointMode('off')
    const written = JSON.parse(await fs.readFile(file, 'utf8')) as {
      checkpointMode?: string
    }
    expect(written.checkpointMode).toBeUndefined()
    expect(await store.getCheckpointMode()).toBe('off')
  })

  it('falls back to off, not to blocking, for a junk checkpoint mode (v3.1)', async () => {
    // A corrupted value must not switch a safety feature on behind the user's back.
    await fs.writeFile(
      file,
      JSON.stringify({ version: SETTINGS_SCHEMA_VERSION, checkpointMode: 'yes-please' }),
      'utf8'
    )
    const store = new Persistence({ file, cipher })
    expect(await store.getCheckpointMode()).toBe('off')
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
      createdAt: expect.any(Number),
      // v2.3.2 C.1 — new projects get metadata defaults.
      updatedAt: expect.any(Number),
      environment: 'development',
      auditLogPath: 'C:/projects/ai-desktop/.ai-desktop/audit.log'
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

  it('B-14: keeps a newer (future) payload intact instead of downgrading it', async () => {
    const apiKeyEnc = await cipher.encrypt('sk-future')
    const future = {
      version: SETTINGS_SCHEMA_VERSION + 1,
      activeProvider: 'deepseek',
      providers: { deepseek: { apiKeyEnc, model: 'future-model' } },
      projects: [],
      updatedAt: 1,
      // A field written by the newer build; this build knows nothing about it.
      betaOnlyField: { experimental: true }
    }
    const original = `${JSON.stringify(future, null, 2)}\n`
    await fs.writeFile(file, original, 'utf8')

    const store = new Persistence({ file, cipher })
    await store.load()

    // Untouched on disk: no downgrade, no dropped fields.
    expect(await fs.readFile(file, 'utf8')).toBe(original)
    expect(JSON.parse(await fs.readFile(file, 'utf8')).betaOnlyField).toEqual({ experimental: true })
    // The known fields are still readable, so the app keeps working.
    expect(store.getSettings().activeProvider).toBe('deepseek')
    expect(store.getSettings().providers.deepseek?.model).toBe('future-model')
    expect(await store.getApiKey('deepseek')).toBe('sk-future')
  })

  it('B-14: still migrates and rewrites an older payload', async () => {
    await fs.writeFile(
      file,
      JSON.stringify({ version: SETTINGS_SCHEMA_VERSION - 1, activeProvider: 'deepseek' }),
      'utf8'
    )

    const store = new Persistence({ file, cipher })
    await store.load()

    const onDisk = JSON.parse(await fs.readFile(file, 'utf8'))
    expect(onDisk.version).toBe(SETTINGS_SCHEMA_VERSION)
    expect(onDisk.activeProvider).toBe('deepseek')
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
    expect(settings.approvalMode).toBe('auto-write')
    expect(settings.planModeDefault).toBe(true)
  })

  it('maps legacy v2.2 approval mode names onto v2.3', async () => {
    const auto = await migrateSettings({ version: 1, approvalMode: 'auto' }, cipher, 7)
    const dangerous = await migrateSettings({ version: 1, approvalMode: 'dangerous' }, cipher, 7)
    expect(auto.approvalMode).toBe('full')
    expect(dangerous.approvalMode).toBe('ask')
  })

  it('ignores an unknown approval mode', async () => {
    const settings = await migrateSettings({ version: 1, approvalMode: 'yolo' }, cipher, 7)
    expect(settings.approvalMode).toBeUndefined()
  })
})

describe('approval preferences persistence', () => {
  it('round-trips approvalMode and planModeDefault', async () => {
    const store = new Persistence({ file, cipher })
    await store.setApprovalMode('auto-write')
    await store.setPlanModeDefault(true)

    const reloaded = new Persistence({ file, cipher })
    const settings = await reloaded.load()
    expect(settings.approvalMode).toBe('auto-write')
    expect(settings.planModeDefault).toBe(true)
    expect(reloaded.redacted()).toMatchObject({ approvalMode: 'auto-write', planModeDefault: true })
  })

  it('round-trips rememberApprovalMode', async () => {
    const store = new Persistence({ file, cipher })
    await store.setRememberApprovalMode(true)

    const reloaded = new Persistence({ file, cipher })
    const settings = await reloaded.load()
    expect(settings.rememberApprovalMode).toBe(true)
    expect(reloaded.redacted()).toMatchObject({ rememberApprovalMode: true })
  })
})
