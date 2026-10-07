import { join } from 'node:path'
import { Persistence, resolveUserDataDir } from '@core/agent/persistence'
import { FileSessionStore } from '@core/agent/session-store'
import { createSafeStorageCipher } from './secure-cipher'

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

/** Directory for sandbox workspaces. */
export function sandboxDir(dir = appDataDir()): string {
  return join(dir, 'sandboxes')
}
