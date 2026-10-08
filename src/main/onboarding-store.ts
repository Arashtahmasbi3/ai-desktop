import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'
import type { OnboardingStatus } from '@shared/onboarding'

export const ONBOARDING_SCHEMA_VERSION = 1

interface OnboardingFile {
  version: number
  completedAt?: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export interface OnboardingStoreOptions {
  file: string
  now?: () => number
}

/**
 * Persists whether the first-run wizard has been completed. Contains no
 * secrets, so it is stored as plain JSON next to the other app data.
 */
export class OnboardingStore {
  private readonly file: string
  private readonly now: () => number
  private status: OnboardingStatus = { completed: false }
  private loaded = false

  constructor(options: OnboardingStoreOptions) {
    this.file = options.file
    this.now = options.now ?? (() => Date.now())
  }

  async load(): Promise<OnboardingStatus> {
    if (this.loaded) return this.status
    try {
      const raw: unknown = JSON.parse(await fs.readFile(this.file, 'utf8'))
      if (isRecord(raw) && typeof raw.completedAt === 'number') {
        this.status = { completed: true, completedAt: raw.completedAt }
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error
      this.status = { completed: false }
    }
    this.loaded = true
    return this.status
  }

  async complete(): Promise<OnboardingStatus> {
    await this.load()
    this.status = { completed: true, completedAt: this.now() }
    await this.persist()
    return this.status
  }

  /** Re-arm the wizard (used by tests and a future "show again" action). */
  async reset(): Promise<OnboardingStatus> {
    this.status = { completed: false }
    this.loaded = true
    await this.persist()
    return this.status
  }

  private async persist(): Promise<void> {
    const payload: OnboardingFile = {
      version: ONBOARDING_SCHEMA_VERSION,
      ...(this.status.completedAt ? { completedAt: this.status.completedAt } : {})
    }
    await fs.mkdir(dirname(this.file), { recursive: true })
    const tmp = `${this.file}.${process.pid}.${Date.now()}.tmp`
    await fs.writeFile(tmp, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
    await fs.rename(tmp, this.file)
  }
}
