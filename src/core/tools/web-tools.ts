import { lookup } from 'node:dns/promises'
import type { ToolDefinition } from '@shared/types'
import type { AgentAction, AgentToolResult } from '@shared/agent'
import type { ToolExecutor, ToolExecOptions } from '@core/agent/tools'
import type { ToolGroup } from './toolset'

/**
 * `web_fetch` and `web_search` (T06/T05).
 *
 * Both are network egress chosen by the model, so the guards are the feature:
 *  - only `http`/`https`, never credentials in the URL, never a private address — checked on the URL *and* on every
 *    redirect hop, because "a public URL that redirects to 169.254.169.254" is the classic way past a naive check;
 *  - the body is capped and the request is time-limited, so a hostile endpoint cannot exhaust the app;
 *  - `web_search` fails **closed** when no key is configured, with a sentence that says so, instead of returning an
 *    empty list that reads as "nothing found".
 *
 * Known limit, stated rather than hidden: addresses are resolved once, before the request, and every resolved address
 * must be public. A DNS answer that changes between that check and the connection (rebinding) is not fully covered; the
 * check narrows the window rather than closing it.
 */
export interface WebToolDeps {
  fetchImpl?: typeof fetch
  /** Resolve a hostname to its addresses; injectable so tests never touch DNS. */
  resolveHost?: (host: string) => Promise<string[]>
  /** The search API key. Absent means "not configured", and `web_search` says exactly that. */
  searchKey?: string
  /** Brave's web-search endpoint; overridable for a test or another compatible provider. */
  searchEndpoint?: string
  now?: () => number
}

const DEFAULT_MAX_BYTES = 2_000_000
const MAX_REDIRECTS = 3
const FETCH_TIMEOUT_MS = 20_000
const SEARCH_TIMEOUT_MS = 15_000
const MAX_RESULTS = 10

export const webFetchTool: ToolDefinition = {
  name: 'web_fetch',
  description:
    'Fetch a public http(s) URL and return its text (capped). Refuses private addresses, credentials in the URL, non-text content and redirects to private hosts.',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'Absolute http(s) URL' },
      max_bytes: { type: 'number', description: 'Body cap in bytes (default 2,000,000)' }
    },
    required: ['url'],
    additionalProperties: false
  }
}

export const webSearchTool: ToolDefinition = {
  name: 'web_search',
  description:
    'Search the web (Brave-compatible API). Needs a configured key; without one it reports that it is not configured.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string' },
      count: { type: 'number', description: 'Results to return (default 5, max 10)' }
    },
    required: ['query'],
    additionalProperties: false
  }
}

export const WEB_TOOLS: ToolDefinition[] = [webFetchTool, webSearchTool]

const NAMES = new Set(WEB_TOOLS.map((tool) => tool.name))

const PRIVATE_V4 = [
  /^0\./,
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./
]

/** Localhost, link-local, unique-local and IPv4-mapped forms are all "inside" as far as this tool is concerned. */
export function isPrivateAddress(address: string): boolean {
  const value = address.trim().toLowerCase()
  if (value === '::1' || value === '::' || value.startsWith('fe80:') || value.startsWith('fc') || value.startsWith('fd')) {
    return true
  }
  const mapped = /^::ffff:(.+)$/.exec(value)
  const v4 = mapped ? mapped[1]! : value
  if (v4.includes(':')) return false
  return PRIVATE_V4.some((pattern) => pattern.test(v4))
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export class WebToolExecutor implements ToolExecutor {
  constructor(private readonly deps: WebToolDeps = {}) {}

  async execute(action: AgentAction, _options: ToolExecOptions = {}): Promise<AgentToolResult> {
    const startedAt = Date.now()
    const base = { actionId: action.id, name: action.name, attempts: 1 }
    if (!NAMES.has(action.name)) {
      return { ...base, ok: false, output: '', error: `Unknown tool "${action.name}"`, code: 'unknown_tool', durationMs: 0 }
    }
    if (!action.valid) {
      return {
        ...base,
        ok: false,
        output: '',
        error: `${action.name} received malformed arguments`,
        code: 'invalid_arguments',
        durationMs: Date.now() - startedAt
      }
    }
    try {
      if (action.name === 'web_fetch') return await this.fetchUrl(action, startedAt)
      return await this.search(action, startedAt)
    } catch (error) {
      return { ...base, ok: false, output: '', error: messageOf(error), code: 'remote_error', durationMs: Date.now() - startedAt }
    }
  }

  private resolve(): (host: string) => Promise<string[]> {
    if (this.deps.resolveHost) return this.deps.resolveHost
    return async (host) => (await lookup(host, { all: true })).map((entry) => entry.address)
  }

  /** Scheme, credentials and address class — applied to the request URL and to every redirect target. */
  private async assertPublicUrl(raw: string): Promise<URL> {
    const url = new URL(raw)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('web_fetch accepts only http and https URLs')
    }
    if (url.username !== '' || url.password !== '') {
      throw new Error('web_fetch refuses a URL that carries credentials')
    }
    const host = url.hostname.replace(/^\[|\]$/g, '')
    const addresses = /^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(':') ? [host] : await this.resolve()(host)
    if (addresses.length === 0) throw new Error(`web_fetch could not resolve ${host}`)
    for (const address of addresses) {
      if (isPrivateAddress(address)) {
        throw new Error(`web_fetch refuses ${host}: it resolves to a private address (${address})`)
      }
    }
    return url
  }

  private async fetchUrl(action: AgentAction, startedAt: number): Promise<AgentToolResult> {
    const raw = typeof action.arguments.url === 'string' ? action.arguments.url.trim() : ''
    const fail = (error: string, code: AgentToolResult['code']): AgentToolResult => ({
      actionId: action.id,
      name: action.name,
      ok: false,
      output: '',
      error,
      code,
      attempts: 1,
      durationMs: Date.now() - startedAt
    })
    if (raw === '') return fail('web_fetch requires "url"', 'invalid_arguments')

    let url: URL
    try {
      url = await this.assertPublicUrl(raw)
    } catch (error) {
      return fail(messageOf(error), 'invalid_arguments')
    }

    const maxBytes = Math.max(1_024, Math.min(Number(action.arguments.max_bytes) || DEFAULT_MAX_BYTES, DEFAULT_MAX_BYTES))
    const impl = this.deps.fetchImpl ?? fetch
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    try {
      let current = url
      for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
        const response = await impl(current, {
          redirect: 'manual',
          signal: controller.signal,
          headers: { 'user-agent': 'AI-Desktop/4.5 (+web_fetch)' }
        })
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const location = response.headers.get('location')
          if (!location) return fail(`redirect ${response.status} without a location`, 'remote_error')
          const next = new URL(location, current)
          try {
            current = await this.assertPublicUrl(next.toString())
          } catch (error) {
            return fail(messageOf(error), 'invalid_arguments')
          }
          continue
        }

        const type = response.headers.get('content-type') ?? ''
        if (type !== '' && !/^(text\/|application\/(json|xml|xhtml|javascript))/.test(type)) {
          return fail(`web_fetch refuses content-type "${type}"`, 'invalid_arguments')
        }
        const text = await this.readCapped(response, maxBytes)
        return {
          actionId: action.id,
          name: action.name,
          ok: true,
          output: `URL: ${current.toString()}\nStatus: ${response.status}\n\n${text}`,
          attempts: 1,
          durationMs: Date.now() - startedAt
        }
      }
      return fail(`web_fetch followed more than ${MAX_REDIRECTS} redirects`, 'remote_error')
    } catch (error) {
      return fail(messageOf(error), 'remote_error')
    } finally {
      clearTimeout(timer)
    }
  }

  private async readCapped(response: Response, maxBytes: number): Promise<string> {
    const body = response.body
    if (!body) return (await response.text()).slice(0, maxBytes)
    const reader = body.getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      chunks.push(value)
      total += value.byteLength
      if (total >= maxBytes) {
        await reader.cancel().catch(() => undefined)
        break
      }
    }
    const merged = new Uint8Array(Math.min(total, maxBytes))
    let offset = 0
    for (const chunk of chunks) {
      const take = Math.min(chunk.byteLength, merged.byteLength - offset)
      merged.set(chunk.subarray(0, take), offset)
      offset += take
      if (offset >= merged.byteLength) break
    }
    return new TextDecoder().decode(merged)
  }

  private async search(action: AgentAction, startedAt: number): Promise<AgentToolResult> {
    const query = typeof action.arguments.query === 'string' ? action.arguments.query.trim() : ''
    const fail = (error: string, code: AgentToolResult['code']): AgentToolResult => ({
      actionId: action.id,
      name: action.name,
      ok: false,
      output: '',
      error,
      code,
      attempts: 1,
      durationMs: Date.now() - startedAt
    })
    if (query === '') return fail('web_search requires "query"', 'invalid_arguments')

    const key = this.deps.searchKey?.trim()
    if (!key) {
      return fail(
        'web_search تنظیم نشده است: کلید جست‌وجو را در تنظیمات برنامه وارد کنید (AI_DESKTOP_SEARCH_KEY).',
        'invalid_arguments'
      )
    }

    const count = Math.max(1, Math.min(Number(action.arguments.count) || 5, MAX_RESULTS))
    const endpoint = this.deps.searchEndpoint ?? 'https://api.search.brave.com/res/v1/web/search'
    const url = `${endpoint}?q=${encodeURIComponent(query)}&count=${count}`
    const impl = this.deps.fetchImpl ?? fetch
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS)
    try {
      const response = await impl(url, {
        signal: controller.signal,
        headers: { accept: 'application/json', 'x-subscription-token': key }
      })
      if (response.status === 401 || response.status === 403) {
        return fail('web_search: کلید جست‌وجو پذیرفته نشد.', 'remote_error')
      }
      if (response.status === 429) {
        return fail('web_search: سهمیهٔ جست‌وجو تمام شده است؛ کمی بعد دوباره تلاش کنید.', 'remote_error')
      }
      if (!response.ok) return fail(`web_search: HTTP ${response.status}`, 'remote_error')

      const payload = (await response.json()) as {
        web?: { results?: Array<{ title?: string; url?: string; description?: string }> }
      }
      const results = (payload.web?.results ?? []).slice(0, count)
      if (results.length === 0) {
        return { actionId: action.id, name: action.name, ok: true, output: 'موردی پیدا نشد.', attempts: 1, durationMs: Date.now() - startedAt }
      }
      return {
        actionId: action.id,
        name: action.name,
        ok: true,
        output: results
          .map((result, index) => `${index + 1}. ${result.title ?? '(no title)'}\n   ${result.url ?? ''}\n   ${result.description ?? ''}`)
          .join('\n'),
        attempts: 1,
        durationMs: Date.now() - startedAt
      }
    } catch (error) {
      return fail(messageOf(error), 'remote_error')
    } finally {
      clearTimeout(timer)
    }
  }
}

/** The group a run registers. No key required to register: `web_search` explains its own missing configuration. */
export function createWebToolGroup(deps: WebToolDeps = {}): ToolGroup {
  return {
    definitions: WEB_TOOLS,
    executor: new WebToolExecutor(deps),
    hint:
      'برای خواندن یک صفحهٔ وب از web_fetch (فقط http/https عمومی) و برای جست‌وجو از web_search استفاده کن؛ ' +
      'web_search بدون کلید تنظیم‌شده کار نمی‌کند و این را صریح می‌گوید.'
  }
}
