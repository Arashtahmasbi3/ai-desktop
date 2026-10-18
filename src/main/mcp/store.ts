import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { McpServerConfig, McpServerView } from '@shared/mcp'

/**
 * The MCP server list, as one small JSON file (F0-2).
 *
 * Same shape as the other stores in this app: an injectable directory and clock, atomic writes (write then rename,
 * so a crash cannot leave a half file), and unknown records dropped on read rather than crashing the app. The
 * environment block is kept out of `McpServerView` on purpose: it is where a token would live, and the renderer has
 * no business seeing it.
 */
export interface McpServerStoreOptions {
  baseDir: string
  now?: () => number
}

interface StoredFile {
  version: number
  servers: McpServerConfig[]
}

const FILE = 'mcp.json'
const VERSION = 1

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

/** A record that cannot be turned into a usable server is dropped, not guessed at. */
function toConfig(value: unknown): McpServerConfig | undefined {
  if (!isRecord(value)) return undefined
  const id = readString(value.id)
  const name = readString(value.name)
  const command = readString(value.command)
  if (id === undefined || name === undefined || command === undefined) return undefined
  const args = Array.isArray(value.args)
    ? value.args.filter((argument): argument is string => typeof argument === 'string')
    : []
  const env = isRecord(value.env)
    ? Object.fromEntries(
        Object.entries(value.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
      )
    : undefined
  return {
    id,
    name,
    command,
    args,
    ...(env && Object.keys(env).length > 0 ? { env } : {}),
    enabled: value.enabled !== false,
    createdAt: typeof value.createdAt === 'number' ? value.createdAt : 0
  }
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

  constructor(options: McpServerStoreOptions) {
    this.file = join(options.baseDir, FILE)
    this.now = options.now ?? Date.now
  }

  async list(): Promise<McpServerConfig[]> {
    try {
      const raw = await readFile(this.file, 'utf8')
      const parsed: unknown = JSON.parse(raw)
      const servers = isRecord(parsed) && Array.isArray(parsed.servers) ? parsed.servers : []
      return servers.map(toConfig).filter((entry): entry is McpServerConfig => entry !== undefined)
    } catch {
      // No file yet (or an unreadable one) is an empty list, never a crash: MCP is optional.
      return []
    }
  }

  async save(input: {
    id?: string
    name: string
    command: string
    args?: string[]
    env?: Record<string, string>
    enabled?: boolean
  }): Promise<McpServerConfig> {
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

  private async write(servers: McpServerConfig[]): Promise<void> {
    await mkdir(join(this.file, '..'), { recursive: true })
    const payload: StoredFile = { version: VERSION, servers }
    const temporary = `${this.file}.tmp`
    await writeFile(temporary, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
    await rename(temporary, this.file)
  }
}
