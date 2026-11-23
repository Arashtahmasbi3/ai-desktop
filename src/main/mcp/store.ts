import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { SecretCipher } from '@core/agent/persistence'
import type { McpServerConfig, McpServerInput, McpServerView } from '@shared/mcp'

/**
 * The MCP server list, as one small JSON file (F0-2).
 *
 * Same shape as the other stores in this app: an injectable directory and clock, atomic writes (write then rename,
 * so a crash cannot leave a half file), and unknown records dropped on read rather than crashing the app. The
 * environment block is kept out of `McpServerView` on purpose: it is where a token would live, and the renderer has
 * no business seeing it.
 *
 * v4.3.17 (SEC-5): the file used to hold that environment — the token itself — in cleartext while every other
 * credential in the app went through `SecretCipher`. When a cipher is supplied the values are stored as `envEnc`;
 * a file written before this change is re-encrypted on the first read, the same way provider keys are scrubbed.
 */
export interface McpServerStoreOptions {
  baseDir: string
  now?: () => number
  /** Encrypts environment values. Absent in tests that only exercise the file shape. */
  cipher?: SecretCipher
}

interface StoredFile {
  version: number
  servers: Array<Record<string, unknown>>
}

const FILE = 'mcp.json'
const VERSION = 1

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

function stringRecord(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined
  const out: Record<string, string> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string') out[key] = entry
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/** A short, honest description of how the server starts — never the full environment. */
export function describeLaunch(config: McpServerConfig): string {
  const args = config.args.map((argument) => (argument.includes(' ') ? `"${argument}"` : argument))
  const launch = [config.command, ...args].join(' ')
  return launch.length > 80 ? `${launch.slice(0, 77)}…` : launch
}

export function toView(config: McpServerConfig): McpServerView {
  return {
    id: config.id,
    name: config.name,
    enabled: config.enabled,
    launch: describeLaunch(config),
    createdAt: config.createdAt
  }
}

export class McpServerStore {
  private readonly file: string
  private readonly now: () => number
  private readonly cipher?: SecretCipher

  constructor(options: McpServerStoreOptions) {
    this.file = join(options.baseDir, FILE)
    this.now = options.now ?? Date.now
    if (options.cipher) this.cipher = options.cipher
  }

  async list(): Promise<McpServerConfig[]> {
    let parsed: unknown
    try {
      parsed = JSON.parse(await readFile(this.file, 'utf8'))
    } catch {
      // No file yet (or an unreadable one) is an empty list, never a crash: MCP is optional.
      return []
    }
    const records = isRecord(parsed) && Array.isArray(parsed.servers) ? parsed.servers : []
    const servers: McpServerConfig[] = []
    let legacyPlaintext = false
    for (const record of records) {
      const result = await this.toConfig(record)
      if (result === undefined) continue
      if (result.legacy) legacyPlaintext = true
      servers.push(result.config)
    }
    if (legacyPlaintext && this.cipher) await this.write(servers)
    return servers
  }

  async save(input: McpServerInput): Promise<McpServerConfig> {
    const servers = await this.list()
    const existing = input.id !== undefined ? servers.find((entry) => entry.id === input.id) : undefined
    const id = existing?.id ?? input.id ?? `mcp-${this.now().toString(36)}`
    const record: McpServerConfig = {
      id,
      name: input.name.trim(),
      command: input.command.trim(),
      args: input.args ?? [],
      ...(input.env && Object.keys(input.env).length > 0 ? { env: input.env } : {}),
      enabled: input.enabled ?? existing?.enabled ?? true,
      createdAt: existing?.createdAt ?? this.now()
    }
    const next = existing
      ? servers.map((entry) => (entry.id === id ? record : entry))
      : [...servers, record]
    await this.write(next)
    return record
  }

  async setEnabled(id: string, enabled: boolean): Promise<boolean> {
    const servers = await this.list()
    const found = servers.find((entry) => entry.id === id)
    if (found === undefined) return false
    await this.write(servers.map((entry) => (entry.id === id ? { ...entry, enabled } : entry)))
    return true
  }

  async remove(id: string): Promise<boolean> {
    const servers = await this.list()
    if (!servers.some((entry) => entry.id === id)) return false
    await this.write(servers.filter((entry) => entry.id !== id))
    return true
  }

  /** Decrypt one stored record; `legacy` says it carried a plaintext environment that should be rewritten. */
  private async toConfig(
    value: unknown
  ): Promise<{ config: McpServerConfig; legacy: boolean } | undefined> {
    if (!isRecord(value)) return undefined
    const id = readString(value.id)
    const name = readString(value.name)
    const command = readString(value.command)
    if (id === undefined || name === undefined || command === undefined) return undefined
    const args = Array.isArray(value.args)
      ? value.args.filter((argument): argument is string => typeof argument === 'string')
      : []

    let env: Record<string, string> | undefined
    let legacy = false
    if (this.cipher && isRecord(value.envEnc)) {
      const decrypted: Record<string, string> = {}
      for (const [key, entry] of Object.entries(value.envEnc)) {
        if (typeof entry !== 'string') continue
        try {
          decrypted[key] = await this.cipher.decrypt(entry)
        } catch {
          // A value this build cannot decrypt is dropped rather than reported as the token.
        }
      }
      if (Object.keys(decrypted).length > 0) env = decrypted
    } else {
      env = stringRecord(value.env)
      if (env && this.cipher) legacy = true
    }

    return {
      config: {
        id,
        name,
        command,
        args,
        ...(env && Object.keys(env).length > 0 ? { env } : {}),
        enabled: value.enabled !== false,
        createdAt: typeof value.createdAt === 'number' ? value.createdAt : 0
      },
      legacy
    }
  }

  private async stored(config: McpServerConfig): Promise<Record<string, unknown>> {
    const base: Record<string, unknown> = {
      id: config.id,
      name: config.name,
      command: config.command,
      args: config.args,
      enabled: config.enabled,
      createdAt: config.createdAt
    }
    const env = config.env
    if (!env || Object.keys(env).length === 0) return base
    if (!this.cipher) return { ...base, env }
    const envEnc: Record<string, string> = {}
    for (const [key, value] of Object.entries(env)) envEnc[key] = await this.cipher.encrypt(value)
    return { ...base, envEnc }
  }

  private async write(servers: McpServerConfig[]): Promise<void> {
    await mkdir(join(this.file, '..'), { recursive: true })
    const stored = []
    for (const server of servers) stored.push(await this.stored(server))
    const payload: StoredFile = { version: VERSION, servers: stored }
    const temporary = `${this.file}.tmp`
    await writeFile(temporary, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
    await rename(temporary, this.file)
  }
}
