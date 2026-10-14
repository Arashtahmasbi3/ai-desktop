import { promises as fs } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { writeFileAtomic } from '@core/atomic-write'
import type { SecretCipher } from '@core/agent/persistence'
import { coerceHostPolicy } from '@core/remote/host-policy'
import type { HostPolicy, VpsServer, VpsServerInput, VpsServerView } from '@shared/vps'

export const VPS_SCHEMA_VERSION = 1

interface StoredVpsServer extends VpsServer {
  passwordEnc?: string
  passphraseEnc?: string
}

interface VpsFile {
  version: number
  servers: StoredVpsServer[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

export interface VpsServerStoreOptions {
  file: string
  cipher: SecretCipher
  now?: () => number
  idFactory?: () => string
}

/**
 * Persists VPS connection details. Secrets (password/passphrase) are encrypted
 * with the OS keystore cipher; a private key is referenced by path so it is
 * never copied. The renderer only ever sees {@link VpsServerView}.
 */
export class VpsServerStore {
  private readonly file: string
  private readonly cipher: SecretCipher
  private readonly now: () => number
  private readonly idFactory: () => string
  private servers: StoredVpsServer[] = []
  private loaded = false

  constructor(options: VpsServerStoreOptions) {
    this.file = options.file
    this.cipher = options.cipher
    this.now = options.now ?? (() => Date.now())
    this.idFactory = options.idFactory ?? (() => randomUUID())
  }

  async load(): Promise<void> {
    if (this.loaded) return
    try {
      const raw = JSON.parse(await fs.readFile(this.file, 'utf8')) as unknown
      if (isRecord(raw) && Array.isArray(raw.servers)) {
        this.servers = raw.servers.filter(isRecord).map((entry) => {
          const id = String(entry.id ?? '')
          const policy = coerceHostPolicy(entry.policy, id)
          return {
            id,
            name: String(entry.name ?? ''),
            host: String(entry.host ?? ''),
            port: Number(entry.port ?? 22),
            username: String(entry.username ?? ''),
            authType: entry.authType === 'password' ? 'password' : 'key',
            createdAt: Number(entry.createdAt ?? this.now()),
            updatedAt: Number(entry.updatedAt ?? this.now()),
            ...(asString(entry.privateKeyPath) ? { privateKeyPath: entry.privateKeyPath as string } : {}),
            ...(asString(entry.trustedFingerprint)
              ? { trustedFingerprint: entry.trustedFingerprint as string }
              : {}),
            ...(typeof entry.lastConnectedAt === 'number'
              ? { lastConnectedAt: entry.lastConnectedAt }
              : {}),
            ...(policy ? { policy } : {}),
            ...(asString(entry.passwordEnc) ? { passwordEnc: entry.passwordEnc as string } : {}),
            ...(asString(entry.passphraseEnc) ? { passphraseEnc: entry.passphraseEnc as string } : {})
          }
        })
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error
    }
    this.loaded = true
  }

  private async persist(): Promise<void> {
    const payload: VpsFile = { version: VPS_SCHEMA_VERSION, servers: this.servers }
    await writeFileAtomic(this.file, `${JSON.stringify(payload, null, 2)}\n`)
  }

  private toView(server: StoredVpsServer): VpsServerView {
    return {
      id: server.id,
      name: server.name,
      host: server.host,
      port: server.port,
      username: server.username,
      authType: server.authType,
      hasPassword: Boolean(server.passwordEnc),
      hasPrivateKey: Boolean(server.privateKeyPath),
      ...(server.trustedFingerprint ? { trustedFingerprint: server.trustedFingerprint } : {}),
      createdAt: server.createdAt,
      updatedAt: server.updatedAt,
      ...(server.lastConnectedAt ? { lastConnectedAt: server.lastConnectedAt } : {}),
      ...(server.policy ? { policy: server.policy } : {})
    }
  }

  async list(): Promise<VpsServerView[]> {
    await this.load()
    return this.servers.map((server) => this.toView(server))
  }

  async save(input: VpsServerInput): Promise<VpsServerView> {
    await this.load()
    const name = input.name.trim()
    const host = input.host.trim()
    const username = input.username.trim()
    const port = input.port ?? 22
    if (!name) throw new Error('Server name is required')
    if (!host) throw new Error('Host is required')
    if (!username) throw new Error('Username is required')
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Port must be 1-65535')
    if (input.authType === 'key' && !input.privateKeyPath?.trim()) {
      throw new Error('A private key path is required for key authentication')
    }

    const existing = input.id ? this.servers.find((entry) => entry.id === input.id) : undefined
    const record: StoredVpsServer = existing ?? {
      id: this.idFactory(),
      name,
      host,
      port,
      username,
      authType: input.authType,
      createdAt: this.now(),
      updatedAt: this.now()
    }
    record.name = name
    record.host = host
    record.port = port
    record.username = username
    record.authType = input.authType
    record.updatedAt = this.now()

    if (input.privateKeyPath?.trim()) record.privateKeyPath = input.privateKeyPath.trim()
    else if (input.authType === 'password') delete record.privateKeyPath

    if (input.trustFingerprint?.trim()) {
      record.trustedFingerprint = input.trustFingerprint.trim()
    }

    if (input.policy) {
      const policy = coerceHostPolicy(input.policy, record.id)
      if (policy) record.policy = policy
    }

    const password = input.password?.trim()
    if (password) record.passwordEnc = await this.cipher.encrypt(password)
    const passphrase = input.passphrase?.trim()
    if (passphrase) record.passphraseEnc = await this.cipher.encrypt(passphrase)

    if (!existing) this.servers.push(record)
    await this.persist()
    return this.toView(record)
  }

  async remove(id: string): Promise<boolean> {
    await this.load()
    const before = this.servers.length
    this.servers = this.servers.filter((server) => server.id !== id)
    if (this.servers.length === before) return false
    await this.persist()
    return true
  }

  /** Full record incl. decrypted secrets — main process only. */
  async getDecrypted(id: string): Promise<{
    server: VpsServer
    password?: string
    passphrase?: string
  } | null> {
    await this.load()
    const server = this.servers.find((entry) => entry.id === id)
    if (!server) return null
    const { passwordEnc, passphraseEnc, ...rest } = server
    return {
      server: rest,
      ...(passwordEnc ? { password: await this.cipher.decrypt(passwordEnc) } : {}),
      ...(passphraseEnc ? { passphrase: await this.cipher.decrypt(passphraseEnc) } : {})
    }
  }

  /** The host's command policy, if configured (B.3). */
  async policyFor(id: string): Promise<HostPolicy | undefined> {
    await this.load()
    return this.servers.find((entry) => entry.id === id)?.policy
  }

  async setTrustedFingerprint(id: string, fingerprint: string): Promise<void> {
    await this.load()
    const server = this.servers.find((entry) => entry.id === id)
    if (!server) throw new Error(`Unknown server: ${id}`)
    server.trustedFingerprint = fingerprint
    server.updatedAt = this.now()
    await this.persist()
  }

  async touchConnected(id: string): Promise<void> {
    await this.load()
    const server = this.servers.find((entry) => entry.id === id)
    if (!server) return
    server.lastConnectedAt = this.now()
    await this.persist()
  }
}
