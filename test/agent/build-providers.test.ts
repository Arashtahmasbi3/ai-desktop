import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { AgentService } from '../../src/main/agent-service'
import { Persistence } from '@core/agent/persistence'
import type { SessionStore } from '@core/agent/session-store'
import type { SandboxManager } from '@shared/sandbox'
import { XorCipher } from '../helpers/fake-cipher'

let dir: string
let persistence: Persistence

function makeService(): AgentService {
  return new AgentService({
    sandbox: {} as SandboxManager,
    persistence,
    sessionStore: {} as SessionStore,
    emit: () => undefined
  })
}

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'agent-build-providers-'))
  persistence = new Persistence({ file: join(dir, 'settings.json'), cipher: new XorCipher() })
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe('AgentService.buildProviders', () => {
  it('throws when no API key is configured', async () => {
    await expect(makeService().buildProviders()).rejects.toThrow(/No API key configured/)
  })

  it('overrides the primary provider model with the requested one', async () => {
    await persistence.setApiKey('deepseek', 'sk-test')
    const entries = await makeService().buildProviders({
      preferred: 'deepseek',
      model: 'deepseek-reasoner'
    })
    expect(entries).toHaveLength(1)
    expect(entries[0].provider).toBe('deepseek')
    expect(entries[0].config.model).toBe('deepseek-reasoner')
  })

  it('falls back to the stored/default model when no override is given', async () => {
    await persistence.setApiKey('deepseek', 'sk-test')
    await persistence.setProviderModel('deepseek', 'deepseek-chat')
    const entries = await makeService().buildProviders({ preferred: 'deepseek' })
    expect(entries[0].config.model).toBe('deepseek-chat')
  })

  it('only overrides the primary entry; fallback providers keep their model', async () => {
    await persistence.setApiKey('deepseek', 'sk-ds')
    await persistence.setApiKey('openai', 'sk-oa')
    await persistence.setProviderModel('openai', 'gpt-4o-mini')
    const entries = await makeService().buildProviders({
      preferred: 'deepseek',
      model: 'deepseek-reasoner'
    })
    expect(entries.map((entry) => entry.provider)).toEqual(['deepseek', 'openai'])
    expect(entries[0].config.model).toBe('deepseek-reasoner')
    expect(entries[1].config.model).toBe('gpt-4o-mini')
  })

  it('keeps the requested provider first in the order', async () => {
    await persistence.setApiKey('deepseek', 'sk-ds')
    await persistence.setApiKey('openai', 'sk-oa')
    const entries = await makeService().buildProviders({ preferred: 'openai' })
    expect(entries[0].provider).toBe('openai')
  })
})
