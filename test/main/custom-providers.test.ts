import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { FetchLike } from '@shared/types'
import {
  CUSTOM_PROVIDERS_SCHEMA_VERSION,
  CustomProviderStore,
  migrateCustomProviders,
  normalizeBaseUrl
} from '../../src/main/custom-providers'
import { XorCipher } from '../helpers/fake-cipher'

let dir: string
let file: string
const cipher = new XorCipher()

function makeStore(fetchImpl?: FetchLike): CustomProviderStore {
  return new CustomProviderStore({
    file,
    cipher,
    now: () => 1_000,
    idFactory: () => 'cp-1',
    ...(fetchImpl ? { fetchImpl } : {})
  })
}

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'custom-providers-'))
  file = join(dir, 'custom-providers.json')
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe('normalizeBaseUrl', () => {
  it('trims whitespace and trailing slashes', () => {
    expect(normalizeBaseUrl('  https://api.example.com/v1// ')).toBe('https://api.example.com/v1')
  })
})

describe('migrateCustomProviders', () => {
  it('drops malformed entries and keeps valid ones', () => {
    const providers = migrateCustomProviders(
      {
        version: CUSTOM_PROVIDERS_SCHEMA_VERSION,
        providers: [
          { id: 'a', label: 'A', baseUrl: 'https://a/v1/', model: 'm' },
          { id: 'b', label: 'B' },
          'nonsense'
        ]
      },
      42
    )
    expect(providers).toHaveLength(1)
    expect(providers[0]).toMatchObject({ id: 'a', baseUrl: 'https://a/v1', createdAt: 42 })
  })

  it('returns an empty list for garbage', () => {
    expect(migrateCustomProviders(null)).toEqual([])
    expect(migrateCustomProviders({ providers: 'nope' })).toEqual([])
  })
})

describe('CustomProviderStore', () => {
  it('saves a provider and never writes the plaintext key to disk', async () => {
    const store = makeStore()
    const view = await store.save({
      label: 'Together',
      baseUrl: 'https://api.together.xyz/v1/',
      model: 'llama-3.3',
      apiKey: 'secret-key',
      headers: { 'X-Title': 'AI Desktop' }
    })
    expect(view).toMatchObject({
      id: 'cp-1',
      label: 'Together',
      baseUrl: 'https://api.together.xyz/v1',
      hasApiKey: true,
      headerCount: 1
    })

    const raw = await fs.readFile(file, 'utf8')
    expect(raw).not.toContain('secret-key')
    expect(raw).toContain('enc:')

    const decrypted = await store.getDecrypted('cp-1')
    expect(decrypted).toMatchObject({ apiKey: 'secret-key', model: 'llama-3.3' })
    expect(decrypted?.headers).toEqual({ 'X-Title': 'AI Desktop' })
  })

  it('keeps the stored key when an update omits apiKey', async () => {
    const store = makeStore()
    await store.save({ label: 'A', baseUrl: 'https://a/v1', model: 'm1', apiKey: 'keep-me' })
    await store.save({ id: 'cp-1', label: 'A2', baseUrl: 'https://a/v1', model: 'm2' })
    const decrypted = await store.getDecrypted('cp-1')
    expect(decrypted?.apiKey).toBe('keep-me')
    expect(decrypted?.label).toBe('A2')
    expect(decrypted?.model).toBe('m2')
  })

  it('removes a provider', async () => {
    const store = makeStore()
    await store.save({ label: 'A', baseUrl: 'https://a/v1', model: 'm' })
    expect(await store.remove('cp-1')).toBe(true)
    expect(await store.remove('cp-1')).toBe(false)
    expect(store.list()).toEqual([])
  })

  it('validates required fields', async () => {
    const store = makeStore()
    await expect(store.save({ label: '', baseUrl: 'https://a', model: 'm' })).rejects.toThrow(
      /name is required/
    )
    await expect(store.save({ label: 'A', baseUrl: '', model: 'm' })).rejects.toThrow(
      /Base URL is required/
    )
    await expect(store.save({ label: 'A', baseUrl: 'https://a', model: '' })).rejects.toThrow(
      /Model is required/
    )
  })
})

describe('CustomProviderStore.test', () => {
  const okResponse = { ok: true, status: 200 } as Response

  it('reports success and latency', async () => {
    const calls: Array<{ url: string; body: unknown; headers: Record<string, string> }> = []
    const fetchImpl: FetchLike = async (url, init) => {
      calls.push({
        url: String(url),
        body: JSON.parse(String(init?.body)),
        headers: init?.headers as Record<string, string>
      })
      return okResponse
    }
    const result = await makeStore(fetchImpl).test({
      label: 'A',
      baseUrl: 'https://api.example.com/v1/',
      model: 'm',
      apiKey: 'sk-x'
    })
    expect(result.ok).toBe(true)
    expect(calls[0].url).toBe('https://api.example.com/v1/chat/completions')
    expect(calls[0].headers.Authorization).toBe('Bearer sk-x')
    expect((calls[0].body as { model: string }).model).toBe('m')
  })

  it('surfaces HTTP errors without throwing', async () => {
    const fetchImpl: FetchLike = async () => ({ ok: false, status: 401 } as Response)
    const result = await makeStore(fetchImpl).test({
      label: 'A',
      baseUrl: 'https://api.example.com/v1',
      model: 'm',
      apiKey: 'bad'
    })
    expect(result).toMatchObject({ ok: false, message: 'HTTP 401' })
  })

  it('surfaces network errors without throwing', async () => {
    const fetchImpl: FetchLike = async () => {
      throw new Error('ECONNREFUSED')
    }
    const result = await makeStore(fetchImpl).test({
      label: 'A',
      baseUrl: 'https://api.example.com/v1',
      model: 'm',
      apiKey: 'sk-x'
    })
    expect(result).toMatchObject({ ok: false, message: 'ECONNREFUSED' })
  })

  it('falls back to the stored key when apiKey is omitted', async () => {
    const seen: string[] = []
    const fetchImpl: FetchLike = async (_url, init) => {
      seen.push((init?.headers as Record<string, string>).Authorization)
      return okResponse
    }
    const store = makeStore(fetchImpl)
    await store.save({ label: 'A', baseUrl: 'https://a/v1', model: 'm', apiKey: 'stored-key' })
    const result = await store.test({ id: 'cp-1', label: 'A', baseUrl: 'https://a/v1', model: 'm' })
    expect(result.ok).toBe(true)
    expect(seen[0]).toBe('Bearer stored-key')
  })

  it('rejects when no key is available', async () => {
    const result = await makeStore(async () => okResponse).test({
      label: 'A',
      baseUrl: 'https://a/v1',
      model: 'm'
    })
    expect(result).toMatchObject({ ok: false, message: 'API key is required' })
  })
})
