import { promises as fs } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname, isAbsolute, join, normalize, resolve } from 'node:path'
import { homedir } from 'node:os'
import type { ProviderId } from '@shared/types'
import { isWindowsAbsolutePath } from '@shared/paths'
import { coerceApprovalMode, type ApprovalMode } from '@shared/approval'

/** Current on-disk settings schema version. */
export const SETTINGS_SCHEMA_VERSION = 2

/** Symmetric secret cipher. In the app it is backed by Electron `safeStorage`. */
export interface SecretCipher {
  /** Returns an opaque, storable (e.g. base64) representation of the plaintext. */
  encrypt(plaintext: string): Promise<string>
  decrypt(ciphertext: string): Promise<string>
}

export interface ProjectRecord {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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
    return record
  }
  if (old.type === 'local') return record

  if (platform === 'win32' && path.startsWith('/')) {
    record.type = 'remote'
    if (typeof old.vpsId === 'string') record.vpsId = old.vpsId
  }
  return record
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
    if (storedVersion !== SETTINGS_SCHEMA_VERSION) {
      await this.persist()
    }
    return this.settings
  }

  private async persist(): Promise<void> {
    this.settings.version = SETTINGS_SCHEMA_VERSION
    this.settings.updatedAt = this.now()
    await fs.mkdir(dirname(this.file), { recursive: true })
    const tmp = `${this.file}.${process.pid}.${Date.now()}.tmp`
    await fs.writeFile(tmp, `${JSON.stringify(this.settings, null, 2)}\n`, 'utf8')
    await fs.rename(tmp, this.file)
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
        hasApiKey: typeof value.apiKeyEnc === 'string' && value.apiKeyEnc !== '',
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
        : {})
    }
  }

  async setApiKey(provider: ProviderId, apiKey: string): Promise<void> {
    await this.load()
    const current = this.settings.providers[provider] ?? {}
    if (apiKey === '') {
      delete current.apiKeyEnc
    } else {
      current.apiKeyEnc = await this.cipher.encrypt(apiKey)
    }
    this.settings.providers[provider] = current
    await this.persist()
  }

  async getApiKey(provider: ProviderId): Promise<string | undefined> {
    await this.load()
    const enc = this.settings.providers[provider]?.apiKeyEnc
    if (!enc) return undefined
    return this.cipher.decrypt(enc)
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

  getActiveProject(): ProjectRecord | undefined {
    const id = this.settings.activeProjectId
    return id ? this.settings.projects.find((project) => project.id === id) : undefined
  }

  async addProject(
    name: string,
    path: string,
    options: { type?: 'local' | 'remote'; vpsId?: string } = {}
  ): Promise<ProjectRecord> {
    await this.load()
    const normalized =
      options.type === 'remote' ? normalizeRemoteProjectPath(path) : normalizeProjectPath(path)
    const project: ProjectRecord = {
      id: this.idFactory(),
      name: name.trim() || normalized,
      path: normalized,
      createdAt: this.now(),
      ...(options.type === 'remote' ? { type: 'remote' as const } : {}),
      ...(options.type === 'remote' && options.vpsId ? { vpsId: options.vpsId } : {})
    }
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
