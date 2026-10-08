import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { OnboardingStore, ONBOARDING_SCHEMA_VERSION } from '../../src/main/onboarding-store'

let dir: string
let file: string

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'onboarding-'))
  file = join(dir, 'onboarding.json')
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe('OnboardingStore', () => {
  it('starts incomplete when no file exists', async () => {
    const store = new OnboardingStore({ file })
    expect(await store.load()).toEqual({ completed: false })
  })

  it('persists completion with a timestamp', async () => {
    const store = new OnboardingStore({ file, now: () => 12_345 })
    const status = await store.complete()
    expect(status).toEqual({ completed: true, completedAt: 12_345 })

    const raw = JSON.parse(await fs.readFile(file, 'utf8'))
    expect(raw).toEqual({ version: ONBOARDING_SCHEMA_VERSION, completedAt: 12_345 })
  })

  it('restores completion from disk on a fresh instance', async () => {
    await new OnboardingStore({ file, now: () => 999 }).complete()
    expect(await new OnboardingStore({ file }).load()).toEqual({
      completed: true,
      completedAt: 999
    })
  })

  it('resets back to incomplete', async () => {
    const store = new OnboardingStore({ file, now: () => 1 })
    await store.complete()
    expect(await store.reset()).toEqual({ completed: false })
    expect(await new OnboardingStore({ file }).load()).toEqual({ completed: false })
  })

  it('treats a corrupt file as incomplete', async () => {
    await fs.writeFile(file, '{ not json', 'utf8')
    expect(await new OnboardingStore({ file }).load()).toEqual({ completed: false })
  })
})
