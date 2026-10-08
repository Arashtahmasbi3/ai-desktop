import { join } from 'node:path'
import { Persistence, resolveUserDataDir } from '@core/agent/persistence'
import { FileSessionStore } from '@core/agent/session-store'
import { createSafeStorageCipher } from './secure-cipher'
import { CustomProviderStore } from './custom-providers'
import { OnboardingStore } from './onboarding-store'
import { GitHubService } from './github/service'
import { createNodeGitExec } from './github/git'
import { VpsServerStore } from './ssh/server-store'
import { AuditLog } from '@core/agent/audit-log'

/** App data directory (e.g. `%APPDATA%\AI Desktop` on Windows). */
export function appDataDir(appName = 'AI Desktop'): string {
  return resolveUserDataDir({ appName })
}

/** Settings store backed by OS-encrypted API keys. */
export function createSettingsStore(dir = appDataDir()): Persistence {
  return new Persistence({
    file: join(dir, 'settings.json'),
    cipher: createSafeStorageCipher()
  })
}

/** On-disk agent session store. */
export function createSessionStore(dir = appDataDir()): FileSessionStore {
  return new FileSessionStore(join(dir, 'sessions'))
}

/** Store for user-defined OpenAI-compatible providers (encrypted keys). */
export function createCustomProviderStore(dir = appDataDir()): CustomProviderStore {
  return new CustomProviderStore({
    file: join(dir, 'custom-providers.json'),
    cipher: createSafeStorageCipher()
  })
}

/** Directory for sandbox workspaces. */
export function sandboxDir(dir = appDataDir()): string {
  return join(dir, 'sandboxes')
}

/** First-run onboarding state (non-secret). */
export function createOnboardingStore(dir = appDataDir()): OnboardingStore {
  return new OnboardingStore({ file: join(dir, 'onboarding.json') })
}

/** GitHub auth (encrypted token) + git CLI operations. */
export function createGitHubService(dir = appDataDir()): GitHubService {
  return new GitHubService({
    file: join(dir, 'github.json'),
    cipher: createSafeStorageCipher(),
    exec: createNodeGitExec()
  })
}

/** Persisted VPS servers (encrypted secrets, referenced private keys). */
export function createVpsServerStore(dir = appDataDir()): VpsServerStore {
  return new VpsServerStore({
    file: join(dir, 'vps-servers.json'),
    cipher: createSafeStorageCipher()
  })
}

/** JSON trail of every SSH command (allowed, blocked or rate limited). */
export function createAuditLog(dir = appDataDir()): AuditLog {
  return new AuditLog({ file: join(dir, 'ssh-audit.json') })
}
