import { promises as fs } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { isAbsolute, join, normalize, posix, resolve } from 'node:path'
import { homedir } from 'node:os'
import { writeFileAtomic } from '@core/atomic-write'
import type { ProviderId } from '@shared/types'
import { isWindowsAbsolutePath } from '@shared/paths'
import { coerceApprovalMode, type ApprovalMode } from '@shared/approval'
import {
  coerceInvestigateScope,
  coerceSessionProfile,
  parseElevationGrant,
  type ElevationGrant,
  type InvestigateScope,
  type SessionProfile
} from '@shared/profile'
import {
  applyProjectMetadataDefaults,
  isProjectEnvironment,
  type ProjectMetadata,
  type ProjectRepositoryRef
} from '@shared/project-metadata'
import type { HealthCheckConfig, HostPolicy } from '@shared/vps'

/** Current on-disk settings schema version. */
export const SETTINGS_SCHEMA_VERSION = 4

/** Symmetric secret cipher. In the app it is backed by Electron `safeStorage`. */
export interface SecretCipher {
  /** Returns an opaque, storable (e.g. base64) representation of the plaintext. */
  encrypt(plaintext: string): Promise<string>
  decrypt(ciphertext: string): Promise<string>
}

export interface ProjectRecord extends ProjectMetadata {
  id: string
  name: string
  path: string
  createdAt: number
  /** 'local' (default) or 'remote' (a folder on a connected VPS). */
  type?: 'local' | 'remote'
  /** VPS server this remote project lives on. */
  vpsId?: string
}

export interface ProviderSettings {
  /** Encrypted API key (never the plaintext). */
  apiKeyEnc?: string
  /**
   * v3.1: extra encrypted keys for the same provider, so a rate-limited credential can be rotated
   * instead of retried until the run dies. `apiKeyEnc` is the first key and stays authoritative for
   * older builds; `resolveKeys` is the one place that decides what a provider's keys are.
   */
  apiKeysEnc?: string[]
  model?: string
  baseUrl?: string
}

export interface AppSettings {
  version: number
  activeProvider?: ProviderId
  activeProjectId?: string
  providers: Partial<Record<ProviderId, ProviderSettings>>
  projects: ProjectRecord[]
  /** When the agent must ask before acting (v2). */
  approvalMode?: ApprovalMode
  /** Start new chats in Plan Mode by default (v2). */
  planModeDefault?: boolean
  /** Keep the chosen approval mode across restarts instead of resetting to Ask (v2.3). */
  rememberApprovalMode?: boolean
  /** Active Session Profile (v2.6.2, Topic 1). */
  profile?: SessionProfile
  /** Read-only vs plan-only when `profile === 'investigate'` (v2.6.2). */
  investigateScope?: InvestigateScope
  /**
   * Main-side elevation grant (v2.6.2, P0-5). Persisted so an app restart no
   * longer silently *extends* `full`; main re-checks `expiresAt` on every read.
   */
  elevationGrant?: ElevationGrant
  updatedAt: number
}

export interface UserDataDirOptions {
  appName: string
  platform?: NodeJS.Platform
  env?: NodeJS.ProcessEnv
  home?: string
}

/** Platform-appropriate per-user config directory, e.g. `%APPDATA%\AI Desktop`. */
export function resolveUserDataDir(options: UserDataDirOptions): string {
  const platform = options.platform ?? process.platform
  const env = options.env ?? process.env
  const home = options.home ?? homedir()

  if (platform === 'win32') {
    const appData = env.APPDATA ?? join(home, 'AppData', 'Roaming')
    return join(appData, options.appName)
  }
  if (platform === 'darwin') {
    return join(home, 'Library', 'Application Support', options.appName)
  }
  const xdg = env.XDG_CONFIG_HOME ?? join(home, '.config')
  return join(xdg, options.appName)
}

/**
 * Normalize a user-supplied project path and reject anything that is not
 * absolute — relative paths would resolve against the process CWD and silently
 * point at the wrong folder. Throws a clear, user-facing error.
 *
 * The path is also resolved to a canonical absolute form. A Windows drive path
 * keeps its native form on Windows; on POSIX (tests/CI) it is left normalized
 * but untouched, since the desktop target is Windows.
 */
export function normalizeProjectPath(path: string): string {
  const trimmed = path.trim()
  if (trimmed === '') throw new Error('Project path is required.')
  // Accept Windows drive paths even when the check runs on POSIX (tests/CI),
  // since the desktop app targets Windows.
  const windowsAbsolute = isWindowsAbsolutePath(trimmed)
  if (!windowsAbsolute && !isAbsolute(trimmed)) {
    throw new Error(`Project path must be absolute: ${trimmed}`)
  }
  // v2.6.5: a POSIX path stays POSIX on every platform. `resolve()` on Windows
  // rewrote `/home/me/project` as `C:\home\me\project`, which corrupted stored
  // project records and broke the POSIX round-trip that migrateProjectRecord
  // relies on to detect a remote project.
  if (!windowsAbsolute && posix.isAbsolute(trimmed)) {
    const normalizedPosix = posix.normalize(trimmed)
    // `posix.normalize` keeps a trailing slash; the Windows branch drops it, so
    // drop it here too and keep the two forms interchangeable.
    return normalizedPosix.length > 1 ? normalizedPosix.replace(/\/+$/, '') : normalizedPosix
  }
  const normalized = normalize(trimmed)
  if (windowsAbsolute) {
    return process.platform === 'win32' ? resolve(normalized) : normalized
  }
  return resolve(normalized)
}

/**
 * Normalize a path that lives on a remote POSIX host. Unlike local paths it is
 * always absolute-in-POSIX terms (`/opt/app`), even when this process runs on
 * Windows, so the local `path.isAbsolute` check would reject it.
 */
export function normalizeRemoteProjectPath(path: string): string {
  const trimmed = path.trim()
  if (trimmed === '') throw new Error('Project path is required.')
  if (!trimmed.startsWith('/')) {
    throw new Error(`Remote project path must be absolute: ${trimmed}`)
  }
  return normalize(trimmed).replace(/\\/g, '/')
}

function emptySettings(now: number): AppSettings {
  return { version: SETTINGS_SCHEMA_VERSION, providers: {}, projects: [], updatedAt: now }
}

/**
 * Shape of a persisted project record as it may appear on disk (any field could
 * be missing for records written by older builds).
 */
export interface PersistedProjectRecord {
  id?: unknown
  name?: unknown
  path?: unknown
  createdAt?: unknown
  type?: unknown
  vpsId?: unknown
  // v3 metadata (all optional; copied through unchanged when valid).
  updatedAt?: unknown
  environment?: unknown
  auditLogPath?: unknown
  repository?: unknown
  dockerComposeProject?: unknown
  ports?: unknown
  domains?: unknown
  linuxUser?: unknown
  sshKeyRef?: unknown
  sshKeyFingerprint?: unknown
  policy?: unknown
  healthCheck?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function numberArray(value: unknown): number[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === 'number')
    ? (value as number[])
    : undefined
}

function repositoryRef(value: unknown): ProjectRepositoryRef | undefined {
  if (!isRecord(value)) return undefined
  const url = typeof value.url === 'string' ? value.url : undefined
  const branch = typeof value.branch === 'string' ? value.branch : undefined
  if (!url || !branch) return undefined
  return { url, branch }
}

/**
 * Copy the additive v3 metadata from a persisted record, dropping anything with
 * the wrong shape. Nothing already on disk is removed — this only feeds fields
 * forward into the migrated record.
 */
function copyProjectMetadata(old: PersistedProjectRecord, record: ProjectRecord): void {
  if (typeof old.updatedAt === 'number') record.updatedAt = old.updatedAt
  if (isProjectEnvironment(old.environment)) record.environment = old.environment
  if (typeof old.auditLogPath === 'string' && old.auditLogPath !== '') {
    record.auditLogPath = old.auditLogPath
  }
  const repository = repositoryRef(old.repository)
  if (repository) record.repository = repository
  if (typeof old.dockerComposeProject === 'string') {
    record.dockerComposeProject = old.dockerComposeProject
  }
  const ports = numberArray(old.ports)
  if (ports) record.ports = ports
  if (isStringArray(old.domains)) record.domains = old.domains
  if (typeof old.linuxUser === 'string') record.linuxUser = old.linuxUser
  if (typeof old.sshKeyRef === 'string') record.sshKeyRef = old.sshKeyRef
  if (typeof old.sshKeyFingerprint === 'string') record.sshKeyFingerprint = old.sshKeyFingerprint
  if (isRecord(old.policy)) record.policy = old.policy as unknown as HostPolicy
  if (isRecord(old.healthCheck)) record.healthCheck = old.healthCheck as unknown as HealthCheckConfig
}

/**
 * Normalize one persisted project record, migrating legacy records that predate
 * the `type` field. A POSIX path (`/opt/app`) stored while running on Windows is
 * almost certainly a project on a remote Linux VPS rather than a local folder,
 * so it is promoted to a `remote` project with no VPS chosen yet. The UI then
 * asks the user to pick a VPS instead of reporting "Path not found".
 */
export function migrateProjectRecord(
  old: PersistedProjectRecord,
  platform: string,
  now: number
): ProjectRecord {
  const path = typeof old.path === 'string' ? old.path : ''
  const record: ProjectRecord = {
    id: typeof old.id === 'string' ? old.id : randomUUID(),
    name: typeof old.name === 'string' ? old.name : path,
    path,
    createdAt: typeof old.createdAt === 'number' ? old.createdAt : now
  }

  if (old.type === 'remote') {
    record.type = 'remote'
    if (typeof old.vpsId === 'string') record.vpsId = old.vpsId
  } else if (old.type === 'local') {
    // explicitly local — keep as-is
  } else if (platform === 'win32' && path.startsWith('/')) {
    record.type = 'remote'
    if (typeof old.vpsId === 'string') record.vpsId = old.vpsId
  }

  copyProjectMetadata(old, record)
  return applyProjectMetadataDefaults(record, now)
}

function normalizeProjects(
  value: unknown,
  now: number,
  platform: string = process.platform
): ProjectRecord[] {
  if (!Array.isArray(value)) return []
  const projects: ProjectRecord[] = []
  for (const entry of value) {
    if (typeof entry === 'string') {
      // v0 stored bare path strings.
      projects.push(migrateProjectRecord({ path: entry }, platform, now))
    } else if (isRecord(entry) && typeof entry.path === 'string') {
      projects.push(migrateProjectRecord(entry, platform, now))
    }
  }
  return projects
}

/**
 * Upgrade a stored settings payload to the current schema.
 *
 * v0 → v1: a flat `{ provider, apiKey, model, projects: string[] }` shape is
 * migrated into per-provider records; a plaintext `apiKey` is encrypted with the
 * injected cipher so nothing sensitive is ever persisted in the clear.
 */
export async function migrateSettings(
  raw: unknown,
  cipher: SecretCipher,
  now: number = Date.now()
): Promise<AppSettings> {
  if (!isRecord(raw)) return emptySettings(now)
  const version = typeof raw.version === 'number' ? raw.version : 0
  const next: AppSettings = emptySettings(now)

  const applyPrefs = (settings: AppSettings): void => {
    const mode = coerceApprovalMode(raw.approvalMode)
    if (mode) settings.approvalMode = mode
    if (typeof raw.planModeDefault === 'boolean') settings.planModeDefault = raw.planModeDefault
    if (typeof raw.rememberApprovalMode === 'boolean') {
      settings.rememberApprovalMode = raw.rememberApprovalMode
    }
    // v2.6.2 (Topic 1): Session Profile + main-side elevation grant.
    const profile = coerceSessionProfile(raw.profile)
    if (profile) settings.profile = profile
    const scope = coerceInvestigateScope(raw.investigateScope)
    if (scope) settings.investigateScope = scope
    // A malformed grant is dropped rather than trusted (fail-closed).
    const grant = parseElevationGrant(raw.elevationGrant)
    if (grant) settings.elevationGrant = grant
  }

  if (version < 1) {
    const provider = raw.provider as ProviderId | undefined
    const model = typeof raw.model === 'string' ? raw.model : undefined
    const baseUrl = typeof raw.baseUrl === 'string' ? raw.baseUrl : undefined
    if (provider) {
      const settings: ProviderSettings = {}
      if (model) settings.model = model
      if (baseUrl) settings.baseUrl = baseUrl
      if (typeof raw.apiKey === 'string' && raw.apiKey !== '') {
        settings.apiKeyEnc = await cipher.encrypt(raw.apiKey)
      }
      next.providers[provider] = settings
      next.activeProvider = provider
    }
    next.projects = normalizeProjects(raw.projects, now)
    applyPrefs(next)
    return next
  }

  // v1+ (current).
  if (typeof raw.activeProvider === 'string') next.activeProvider = raw.activeProvider as ProviderId
  if (typeof raw.activeProjectId === 'string') next.activeProjectId = raw.activeProjectId
  if (isRecord(raw.providers)) {
    for (const [key, value] of Object.entries(raw.providers)) {
      if (!isRecord(value)) continue
      const settings: ProviderSettings = {}
      if (typeof value.apiKeyEnc === 'string') settings.apiKeyEnc = value.apiKeyEnc
      /*
       * v3.1: the key pool. Omitting this dropped every key after the first on the next read, so a
       * user's rotation keys vanished on restart — silent data loss, caught by the migration test
       * rather than by review. Only non-empty strings survive, so a corrupt entry cannot smuggle a
       * non-string into the cipher.
       */
      if (Array.isArray(value.apiKeysEnc)) {
        const keys = value.apiKeysEnc.filter(
          (entry): entry is string => typeof entry === 'string' && entry !== ''
        )
        if (keys.length > 0) settings.apiKeysEnc = keys
      }
      if (typeof value.model === 'string') settings.model = value.model
      if (typeof value.baseUrl === 'string') settings.baseUrl = value.baseUrl
      next.providers[key as ProviderId] = settings
    }
  }
  next.projects = normalizeProjects(raw.projects, now)
  applyPrefs(next)
  return next
}

export interface PersistenceOptions {
  /** Absolute path of the settings JSON file. */
  file: string
  cipher: SecretCipher
  now?: () => number
  idFactory?: () => string
}

/** A settings view that hides ciphertext, for safe display in a UI. */
export interface RedactedProviderSettings {
  hasApiKey: boolean
  /** v3.1: how many keys this provider has. The keys themselves never reach the UI. */
  keyCount: number
  model?: string
  baseUrl?: string
}

export interface RedactedSettings {
  version: number
  activeProvider?: ProviderId
  activeProjectId?: string
  providers: Partial<Record<ProviderId, RedactedProviderSettings>>
  projects: ProjectRecord[]
  approvalMode?: ApprovalMode
  planModeDefault?: boolean
  rememberApprovalMode?: boolean
  profile?: SessionProfile
  investigateScope?: InvestigateScope
}

/**
 * Persists app settings (API keys, models, projects) to a single JSON file.
 * API keys are encrypted via the injected {@link SecretCipher} before being
 * written; plaintext keys never touch disk.
 */
export class Persistence {
  private readonly file: string
  private readonly cipher: SecretCipher
  private readonly now: () => number
  private readonly idFactory: () => string
  private settings: AppSettings = emptySettings(Date.now())
  private loaded = false

  constructor(options: PersistenceOptions) {
    this.file = options.file
    this.cipher = options.cipher
    this.now = options.now ?? (() => Date.now())
    this.idFactory = options.idFactory ?? (() => randomUUID())
  }

  /** Read + migrate the settings file (idempotent). */
  async load(): Promise<AppSettings> {
    if (this.loaded) return this.settings
    let storedVersion = SETTINGS_SCHEMA_VERSION
    try {
      const text = await fs.readFile(this.file, 'utf8')
      const raw: unknown = JSON.parse(text)
      storedVersion =
        isRecord(raw) && typeof raw.version === 'number' ? raw.version : 0
      this.settings = await migrateSettings(raw, this.cipher, this.now())
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error
      this.settings = emptySettings(this.now())
    }
    this.loaded = true
    // A migrated payload removed nothing sensitive on disk yet; rewrite it so
    // legacy plaintext keys (and any schema drift) are replaced by ciphertext.
    // B-14: only an *older* payload is migrated forward. A file written by a
    // newer (future/beta) build is left untouched — rewriting it would silently
    // drop the fields this build does not know about.
    if (storedVersion < SETTINGS_SCHEMA_VERSION) {
      await this.persist()
    }
    return this.settings
  }

  private async persist(): Promise<void> {
    this.settings.version = SETTINGS_SCHEMA_VERSION
    this.settings.updatedAt = this.now()
    await writeFileAtomic(this.file, `${JSON.stringify(this.settings, null, 2)}\n`)
  }

  getSettings(): AppSettings {
    return this.settings
  }

  /** Settings with API keys replaced by a boolean, safe to send to a renderer. */
  redacted(): RedactedSettings {
    const providers: Partial<Record<ProviderId, RedactedProviderSettings>> = {}
    for (const [key, value] of Object.entries(this.settings.providers)) {
      if (!value) continue
      providers[key as ProviderId] = {
        hasApiKey:
      typeof value.apiKeyEnc === 'string' && value.apiKeyEnc !== ''
        ? true
        : Array.isArray(value.apiKeysEnc) && value.apiKeysEnc.length > 0,
    keyCount: Array.isArray(value.apiKeysEnc) ? value.apiKeysEnc.length : 0,
        ...(value.model ? { model: value.model } : {}),
        ...(value.baseUrl ? { baseUrl: value.baseUrl } : {})
      }
    }
    return {
      version: this.settings.version,
      ...(this.settings.activeProvider ? { activeProvider: this.settings.activeProvider } : {}),
      ...(this.settings.activeProjectId ? { activeProjectId: this.settings.activeProjectId } : {}),
      providers,
      projects: this.settings.projects,
      ...(this.settings.approvalMode ? { approvalMode: this.settings.approvalMode } : {}),
      ...(this.settings.planModeDefault !== undefined
        ? { planModeDefault: this.settings.planModeDefault }
        : {}),
      ...(this.settings.rememberApprovalMode !== undefined
        ? { rememberApprovalMode: this.settings.rememberApprovalMode }
        : {}),
      ...(this.settings.profile ? { profile: this.settings.profile } : {}),
      ...(this.settings.investigateScope
        ? { investigateScope: this.settings.investigateScope }
        : {})
    }
  }

  async setApiKey(provider: ProviderId, apiKey: string): Promise<void> {
    // One representation: a single key is a pool of one. Keeping two fields independently writable
    // is how `hasApiKey` and `keyCount` would end up disagreeing in the UI.
    await this.setApiKeys(provider, apiKey === '' ? [] : [apiKey])
  }

  async getApiKey(provider: ProviderId): Promise<string | undefined> {
    const keys = await this.getApiKeys(provider)
    return keys[0]
  }

  /**
   * Every usable key for a provider, decrypted. A key that fails to decrypt is dropped rather than
   * thrown: one unreadable credential must not make the provider unusable when another key works.
   */
  async getApiKeys(provider: ProviderId): Promise<string[]> {
    await this.load()
    const stored = this.settings.providers[provider]
    if (!stored) return []

    const ciphertexts =
      Array.isArray(stored.apiKeysEnc) && stored.apiKeysEnc.length > 0
        ? stored.apiKeysEnc
        : stored.apiKeyEnc
          ? [stored.apiKeyEnc]
          : []

    const keys: string[] = []
    for (const enc of ciphertexts) {
      if (typeof enc !== 'string' || enc === '') continue
      try {
        const plain = await this.cipher.decrypt(enc)
        if (plain && plain.trim() !== '') keys.push(plain)
      } catch {
        // Skip an undecryptable key; the others still work.
      }
    }
    return keys
  }

  /** Replace every key for a provider. An empty list removes them all. */
  async setApiKeys(provider: ProviderId, apiKeys: readonly string[]): Promise<void> {
    await this.load()
    const current = this.settings.providers[provider] ?? {}
    const clean = apiKeys.filter((key) => typeof key === 'string' && key.trim() !== '')
    if (clean.length === 0) {
      delete current.apiKeyEnc
      delete current.apiKeysEnc
    } else {
      const encrypted: string[] = []
      for (const key of clean) encrypted.push(await this.cipher.encrypt(key))
      current.apiKeysEnc = encrypted
      // Keep the single-key field in step so an older build reading this file still works.
      current.apiKeyEnc = encrypted[0]!
    }
    this.settings.providers[provider] = current
    await this.persist()
  }

  /** Add one more key for a provider (ignored when it is already there). */
  async addApiKey(provider: ProviderId, apiKey: string): Promise<void> {
    const existing = await this.getApiKeys(provider)
    if (apiKey.trim() === '' || existing.includes(apiKey)) return
    await this.setApiKeys(provider, [...existing, apiKey])
  }

  /** Remove the key at `index`, leaving the rest of the pool intact. */
  async removeApiKeyAt(provider: ProviderId, index: number): Promise<void> {
    const existing = await this.getApiKeys(provider)
    if (index < 0 || index >= existing.length) return
    await this.setApiKeys(
      provider,
      existing.filter((_, position) => position !== index)
    )
  }

  async removeApiKey(provider: ProviderId): Promise<void> {
    await this.setApiKey(provider, '')
  }

  async setProviderModel(provider: ProviderId, model: string): Promise<void> {
    await this.load()
    const current = this.settings.providers[provider] ?? {}
    current.model = model
    this.settings.providers[provider] = current
    await this.persist()
  }

  async setActiveProvider(provider: ProviderId): Promise<void> {
    await this.load()
    this.settings.activeProvider = provider
    await this.persist()
  }

  async setActiveProject(id: string | undefined): Promise<void> {
    await this.load()
    if (id === undefined) {
      delete this.settings.activeProjectId
    } else {
      this.settings.activeProjectId = id
    }
    await this.persist()
  }

  async setApprovalMode(mode: ApprovalMode): Promise<void> {
    await this.load()
    this.settings.approvalMode = mode
    await this.persist()
  }

  async setPlanModeDefault(enabled: boolean): Promise<void> {
    await this.load()
    this.settings.planModeDefault = enabled
    await this.persist()
  }

  async setRememberApprovalMode(enabled: boolean): Promise<void> {
    await this.load()
    this.settings.rememberApprovalMode = enabled
    await this.persist()
  }

  /** Persist the active Session Profile (v2.6.2, Topic 1). */
  async setSessionProfile(profile: SessionProfile): Promise<void> {
    await this.load()
    this.settings.profile = profile
    await this.persist()
  }

  /** Persist the Investigate scope (`read-only` | `plan-only`). */
  async setInvestigateScope(scope: InvestigateScope): Promise<void> {
    await this.load()
    this.settings.investigateScope = scope
    await this.persist()
  }

  /**
   * Store (or clear, with `null`) the main-side elevation grant. Expiry is not
   * enforced here — {@link getElevationGrant} always re-checks `expiresAt`.
   */
  async setElevationGrant(grant: ElevationGrant | null): Promise<void> {
    await this.load()
    if (grant === null) {
      delete this.settings.elevationGrant
    } else {
      this.settings.elevationGrant = grant
    }
    await this.persist()
  }

  /** The stored grant, or undefined. Never extends or refreshes a grant. */
  getElevationGrant(): ElevationGrant | undefined {
    return this.settings.elevationGrant
  }

  getActiveProject(): ProjectRecord | undefined {
    const id = this.settings.activeProjectId
    return id ? this.settings.projects.find((project) => project.id === id) : undefined
  }

  async addProject(
    name: string,
    path: string,
    options: { type?: 'local' | 'remote'; vpsId?: string; metadata?: ProjectMetadata } = {}
  ): Promise<ProjectRecord> {
    await this.load()
    const normalized =
      options.type === 'remote' ? normalizeRemoteProjectPath(path) : normalizeProjectPath(path)
    const base: ProjectRecord = {
      id: this.idFactory(),
      name: name.trim() || normalized,
      path: normalized,
      createdAt: this.now(),
      ...(options.type === 'remote' ? { type: 'remote' as const } : {}),
      ...(options.type === 'remote' && options.vpsId ? { vpsId: options.vpsId } : {})
    }
    const project = applyProjectMetadataDefaults(
      { ...base, ...(options.metadata ?? {}) },
      this.now()
    )
    // Avoid duplicate entries for the same folder (and, for remote projects, the
    // same server — the same path can exist on two different VPSs).
    const existing = this.settings.projects.find(
      (entry) => entry.path === project.path && (entry.vpsId ?? '') === (project.vpsId ?? '')
    )
    if (existing) {
      this.settings.activeProjectId = existing.id
      await this.persist()
      return existing
    }
    this.settings.projects.push(project)
    this.settings.activeProjectId = project.id
    await this.persist()
    return project
  }

  /** Merge validated v3 metadata into a project (used by Settings → Projects). */
  async updateProjectMetadata(
    id: string,
    patch: Partial<ProjectMetadata>
  ): Promise<ProjectRecord | null> {
    await this.load()
    const project = this.settings.projects.find((entry) => entry.id === id)
    if (!project) return null
    copyProjectMetadata(patch as PersistedProjectRecord, project)
    project.updatedAt = this.now()
    await this.persist()
    return project
  }

  /** Point an existing project at a new folder (used by the "Locate" action). */
  async updateProjectPath(id: string, path: string): Promise<ProjectRecord | null> {
    await this.load()
    const normalized = normalizeProjectPath(path)
    const project = this.settings.projects.find((entry) => entry.id === id)
    if (!project) return null
    project.path = normalized
    if (!project.name.trim()) project.name = normalized
    await this.persist()
    return project
  }

  async removeProject(id: string): Promise<boolean> {
    await this.load()
    const before = this.settings.projects.length
    this.settings.projects = this.settings.projects.filter((project) => project.id !== id)
    if (this.settings.projects.length === before) return false
    if (this.settings.activeProjectId === id) {
      this.settings.activeProjectId = this.settings.projects[0]?.id
    }
    await this.persist()
    return true
  }

  listProjects(): ProjectRecord[] {
    return [...this.settings.projects]
  }
}
