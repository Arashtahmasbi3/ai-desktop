import type { ProviderEntry } from '@core/agent-orchestrator'
import type { Persistence } from '@core/agent/persistence'
import { withKeyHealth } from '@core/llm-adapters/key-health'
import { KeyPool, poolForKeys, type KeySnapshot } from '@core/llm-adapters/key-pool'
import { PROVIDERS, createAdapterForConfig } from '@core/llm-adapters/registry'
import type { ProviderId } from '@shared/types'
import type { CustomProviderStore } from '../custom-providers'

/**
 * Providers, adapters and key rotation for a run (F0-4).
 *
 * Split out of `agent-service.ts`. The key pools are the one piece of state that has to
 * outlive a run — a key parked by a rate limit stays parked, and the round-robin cursor
 * keeps rotating — so they live next to the only code that reads them.
 */

/** Which provider/model to put first for an agent run. */
export interface ProviderSelection {
  preferred?: ProviderId
  model?: string
  customProviderId?: string
}

export function providerOrder(
  ids: ProviderId[],
  preferred?: ProviderId,
  active?: ProviderId
): ProviderId[] {
  const order: ProviderId[] = []
  for (const id of [preferred, active, ...ids]) {
    if (id && !order.includes(id)) order.push(id)
  }
  return order
}

export interface ProviderFactoryDeps {
  persistence: Persistence
  now: () => number
  customProviders?: CustomProviderStore
}

export class ProviderFactory {
  private readonly persistence: Persistence
  private readonly now: () => number
  private readonly customProviders?: CustomProviderStore
  /** v3.1: one key pool per provider, kept across runs (see the file comment). */
  private readonly keyPools = new Map<string, KeyPool>()

  constructor(deps: ProviderFactoryDeps) {
    this.persistence = deps.persistence
    this.now = deps.now
    if (deps.customProviders) this.customProviders = deps.customProviders
  }

  /** Build provider entries (with keys) ordered by preference. */
  async build(options: ProviderSelection = {}): Promise<ProviderEntry[]> {
    const settings = await this.persistence.load()
    const ids = Object.keys(PROVIDERS) as ProviderId[]
    const order = providerOrder(ids, options.preferred, settings.activeProvider)

    const entries: ProviderEntry[] = []
    let primaryIsCustom = false

    if (options.customProviderId) {
      const custom = this.customProviders
        ? await this.customProviders.getDecrypted(options.customProviderId)
        : null
      if (!custom) {
        throw new Error('Selected custom provider was not found. Re-add it in Settings.')
      }
      // Custom endpoints speak the OpenAI protocol, so they reuse that adapter.
      const config = {
        provider: 'openai' as ProviderId,
        apiKey: custom.apiKey,
        model: options.model ?? custom.model,
        baseUrl: custom.baseUrl,
        ...(custom.headers ? { headers: custom.headers } : {})
      }
      entries.push({ provider: 'openai', adapter: createAdapterForConfig(config), config })
      primaryIsCustom = true
    }

    const candidates: Array<{
      id: ProviderId
      apiKey: string
      keyId?: string
      pool?: KeyPool
      model?: string
      baseUrl?: string
    }> = []
    for (const id of order) {
      const stored = settings.providers[id]
      if (!stored?.apiKeyEnc && !stored?.apiKeysEnc?.length) continue
      const keys = await this.persistence.getApiKeys(id)
      if (keys.length === 0) continue

      /*
       * v3.1: one candidate per key. The pool hands them out in its own order and **skips a key
       * that is cooling down**, so the fallback loop that already existed now rotates credentials
       * as well as providers — which is what a rate limit actually needs.
       */
      const pool = this.ensureKeyPool(id, keys)
      for (let slot = 0; slot < pool.size; slot += 1) {
        const next = pool.next()
        if (!next) break
        candidates.push({
          id,
          apiKey: next.apiKey,
          keyId: next.id,
          pool,
          ...(stored.model ? { model: stored.model } : {}),
          ...(stored.baseUrl ? { baseUrl: stored.baseUrl } : {})
        })
      }
    }

    /*
     * v3.1: the chat header's model override belongs to the **primary provider**, not to whichever
     * candidate happens to sit at index 0. With a key pool, index 0 is only the first *key* of that
     * provider, so keying the override off the index alone made a rotated key silently drop back to
     * the provider's configured model — a different model than the user picked, with nothing to say
     * so. With one key per provider the two rules are identical, so nothing changes for anyone who
     * has not added a second key.
     */
    const primaryProvider = candidates[0]?.id

    entries.push(
      ...candidates.map((candidate) => {
        const descriptor = PROVIDERS[candidate.id]
        const model =
          !primaryIsCustom && candidate.id === primaryProvider && options.model
            ? options.model
            : (candidate.model ?? descriptor.defaultModel)
        const config = {
          provider: candidate.id,
          apiKey: candidate.apiKey,
          model,
          baseUrl: candidate.baseUrl ?? descriptor.defaultBaseUrl
        }
        const adapter = createAdapterForConfig(config)
        return {
          provider: candidate.id,
          /*
           * Wrapped so the pool learns the outcome: a key is parked after a rate limit (honouring
           * the provider's Retry-After) or repeated failures, and cleared on success. The wrapper
           * rethrows the original error, so recovery still sees its code.
           */
          adapter:
            candidate.pool && candidate.keyId
              ? withKeyHealth(adapter, candidate.pool, candidate.keyId)
              : adapter,
          config
        }
      })
    )

    if (entries.length === 0) {
      throw new Error('No API key configured. Add one in Settings.')
    }

    return entries
  }

  /** The pool for a provider, rebuilt only when the set of keys actually changed. */
  private ensureKeyPool(provider: ProviderId, keys: readonly string[]): KeyPool {
    const existing = this.keyPools.get(provider)
    if (existing && existing.size === keys.length) return existing
    const pool = poolForKeys(provider, keys, { now: () => this.now() })
    this.keyPools.set(provider, pool)
    return pool
  }

  /**
   * v3.1: per-provider key states for Settings — which credential is ready, which is cooling down,
   * and until when. Never the keys: `KeyPool.snapshot()` cannot return them.
   */
  keyHealth(): Array<{ provider: string; keys: KeySnapshot[] }> {
    return [...this.keyPools.entries()].map(([provider, pool]) => ({
      provider,
      keys: pool.snapshot()
    }))
  }

  /** One bounded, non-streaming completion with the user's own provider and key. */
  async completeOnce(prompt: string): Promise<string> {
    const settings = await this.persistence.load()
    const ids = Object.keys(settings.providers) as ProviderId[]
    const order = providerOrder(ids, undefined, settings.activeProvider)
    for (const id of order) {
      const stored = settings.providers[id]
      if (!stored?.apiKeyEnc) continue
      const apiKey = await this.persistence.getApiKey(id)
      if (!apiKey) continue
      const descriptor = PROVIDERS[id]
      const config = {
        provider: id,
        apiKey,
        model: stored.model ?? descriptor.defaultModel,
        baseUrl: stored.baseUrl ?? descriptor.defaultBaseUrl
      }
      const response = await createAdapterForConfig(config).chat(
        { model: config.model, temperature: 0, messages: [{ role: 'user', content: prompt }] },
        config
      )
      return response.content ?? ''
    }
    throw new Error('no provider is configured, so memory cannot be extracted')
  }
}