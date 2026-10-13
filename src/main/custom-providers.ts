import { promises as fs } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { writeFileAtomic } from '@core/atomic-write'
import type {
  CustomProvider,
  CustomProviderInput,
  CustomProviderTestResult,
  CustomProviderView,
  FetchLike
} from '@shared/types'
import type { SecretCipher } from '@core/agent/persistence'

export const CUSTOM_PROVIDERS_SCHEMA_VERSION = 1

/** On-disk shape: a {@link CustomProvider} plus the encrypted key. */
interface StoredCustomProvider extends CustomProvider {
  apiKeyEnc?: string
}

interface CustomProvidersFile {
  version: number
  providers: StoredCustomProvider[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

function asHeaders(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined
  const headers: Record<string, string> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string') headers[key] = entry
  }
  return Object.keys(headers).length > 0 ? headers : undefined
}

/** Remove a trailing slash so we can append `/chat/completions` predictably. */
export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '')
}

/** Normalize whatever is on disk into a list of stored providers. */
export function migrateCustomProviders(raw: unknown, now = Date.now()): StoredCustomProvider[] {
  if (!isRecord(raw)) return []
  const list = Array.isArray(raw.providers) ? raw.providers : []
  const providers: StoredCustomProvider[] = []
  for (const entry of list) {
    if (!isRecord(entry)) continue
    const id = asString(entry.id)
    const label = asString(entry.label)
    const baseUrl = asString(entry.baseUrl)
    const model = asString(entry.model)
    if (!id || !label || !baseUrl || !model) continue
    providers.push({
      id,
      label,
      baseUrl: normalizeBaseUrl(baseUrl),
      model,
      createdAt: typeof entry.createdAt === 'number' ? entry.createdAt : now,
      updatedAt: typeof entry.updatedAt === 'number' ? entry.updatedAt : now,
      ...(asHeaders(entry.headers) ? { headers: asHeaders(entry.headers) } : {}),
      ...(asString(entry.apiKeyEnc) ? { apiKeyEnc: entry.apiKeyEnc as string } : {})
    })
  }
  return providers
}

export interface CustomProviderStoreOptions {
  file: string
  cipher: SecretCipher
  now?: () => number
  idFactory?: () => string
  /** Injectable fetch for the connection test (defaults to the global fetch). */
  fetchImpl?: FetchLike
}

/**
 * Persists user-configured OpenAI-compatible providers. API keys are encrypted
 * with the same {@link SecretCipher} used for the built-in providers, so only
 * ciphertext ever touches disk.
 */
export class CustomProviderStore {
  private readonly file: string
  private readonly cipher: SecretCipher
  private readonly now: () => number
  private readonly idFactory: () => string
  private readonly fetchImpl?: FetchLike
  private providers: StoredCustomProvider[] = []
  private loaded = false

  constructor(options: CustomProviderStoreOptions) {
    this.file = options.file
    this.cipher = options.cipher
    this.now = options.now ?? (() => Date.now())
    this.idFactory = options.idFactory ?? (() => randomUUID())
    if (options.fetchImpl) this.fetchImpl = options.fetchImpl
  }

  async load(): Promise<void> {
    if (this.loaded) return
    let raw: unknown
    let migrate = false
    try {
      const text = await fs.readFile(this.file, 'utf8')
      raw = JSON.parse(text)
      migrate =
        isRecord(raw) && raw.version !== CUSTOM_PROVIDERS_SCHEMA_VERSION
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error
      raw = undefined
    }
    this.providers = migrateCustomProviders(raw, this.now())
    this.loaded = true
    if (migrate) await this.persist()
  }

  private async persist(): Promise<void> {
    const payload: CustomProvidersFile = {
      version: CUSTOM_PROVIDERS_SCHEMA_VERSION,
      providers: this.providers
    }
    await writeFileAtomic(this.file, `${JSON.stringify(payload, null, 2)}\n`)
  }

  /** Public, secret-free list for the renderer. */
  list(): CustomProviderView[] {
    return this.providers.map((provider) => ({
      id: provider.id,
      label: provider.label,
      baseUrl: provider.baseUrl,
      model: provider.model,
      hasApiKey: typeof provider.apiKeyEnc === 'string' && provider.apiKeyEnc !== '',
      headerCount: provider.headers ? Object.keys(provider.headers).length : 0
    }))
  }

  async save(input: CustomProviderInput): Promise<CustomProviderView> {
    await this.load()
    const label = input.label.trim()
    const baseUrl = normalizeBaseUrl(input.baseUrl)
    const model = input.model.trim()
    if (!label) throw new Error('Provider name is required')
    if (!baseUrl) throw new Error('Base URL is required')
    if (!model) throw new Error('Model is required')

    const existing = input.id ? this.providers.find((entry) => entry.id === input.id) : undefined
    const headers = asHeaders(input.headers)
    const apiKey = input.apiKey?.trim()

    let id: string
    if (existing) {
      id = existing.id
      existing.label = label
      existing.baseUrl = baseUrl
      existing.model = model
      existing.updatedAt = this.now()
      if (headers) existing.headers = headers
      else delete existing.headers
      if (apiKey) existing.apiKeyEnc = await this.cipher.encrypt(apiKey)
    } else {
      id = this.idFactory()
      const created: StoredCustomProvider = {
        id,
        label,
        baseUrl,
        model,
        createdAt: this.now(),
        updatedAt: this.now()
      }
      if (headers) created.headers = headers
      if (apiKey) created.apiKeyEnc = await this.cipher.encrypt(apiKey)
      this.providers.push(created)
    }

    await this.persist()
    return this.list().find((entry) => entry.id === id)!
  }

  async remove(id: string): Promise<boolean> {
    await this.load()
    const before = this.providers.length
    this.providers = this.providers.filter((provider) => provider.id !== id)
    if (this.providers.length === before) return false
    await this.persist()
    return true
  }

  /** Decrypted connection details used by AgentService when running a task. */
  async getDecrypted(id: string): Promise<{
    label: string
    baseUrl: string
    model: string
    apiKey: string
    headers?: Record<string, string>
  } | null> {
    await this.load()
    const provider = this.providers.find((entry) => entry.id === id)
    if (!provider) return null
    const apiKey = provider.apiKeyEnc ? await this.cipher.decrypt(provider.apiKeyEnc) : ''
    return {
      label: provider.label,
      baseUrl: provider.baseUrl,
      model: provider.model,
      apiKey,
      ...(provider.headers ? { headers: provider.headers } : {})
    }
  }

  /**
   * Send a 1-token chat request to confirm the endpoint+key work. Never throws:
   * failures come back as `{ ok: false, message }`.
   */
  async test(input: CustomProviderInput): Promise<CustomProviderTestResult> {
    await this.load()
    const started = this.now()
    const baseUrl = normalizeBaseUrl(input.baseUrl)
    const model = input.model.trim()
    let apiKey = input.apiKey?.trim()
    if (!apiKey && input.id) {
      const stored = this.providers.find((entry) => entry.id === input.id)
      if (stored?.apiKeyEnc) apiKey = await this.cipher.decrypt(stored.apiKeyEnc)
    }

    if (!baseUrl) return { ok: false, latencyMs: 0, message: 'Base URL is required' }
    if (!model) return { ok: false, latencyMs: 0, message: 'Model is required' }
    if (!apiKey) return { ok: false, latencyMs: 0, message: 'API key is required' }

    const fetchImpl = this.fetchImpl ?? (globalThis.fetch as FetchLike)
    if (!fetchImpl) return { ok: false, latencyMs: 0, message: 'fetch is unavailable' }

    try {
      const response = await fetchImpl(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          ...(asHeaders(input.headers) ?? {})
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1,
          stream: false
        })
      })
      const latencyMs = this.now() - started
      if (!response.ok) {
        return { ok: false, latencyMs, message: `HTTP ${response.status}` }
      }
      return { ok: true, latencyMs }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false, latencyMs: this.now() - started, message }
    }
  }
}
