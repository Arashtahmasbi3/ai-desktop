import { describe, it, expect } from 'vitest'
import {
  EXCLUDED_ALWAYS,
  buildContextPreview,
  estimateTokens,
  formatContextPreview,
  isSecretPath
} from '@shared/context-preview'

describe('estimateTokens', () => {
  it('approximates four characters per token and floors at zero', () => {
    expect(estimateTokens('')).toBe(0)
    expect(estimateTokens('abcd')).toBe(1)
    expect(estimateTokens('a'.repeat(9))).toBe(3)
  })
})

describe('isSecretPath', () => {
  it('flags secret-looking files and passes normal sources', () => {
    expect(isSecretPath('.env')).toBe(true)
    expect(isSecretPath('config/.env.local')).toBe(true)
    expect(isSecretPath('certs/server.pem')).toBe(true)
    expect(isSecretPath('.ssh/id_rsa')).toBe(true)
    expect(isSecretPath('src/index.ts')).toBe(false)
    expect(isSecretPath('package.json')).toBe(false)
    expect(isSecretPath('environment.ts')).toBe(false)
  })
})

describe('buildContextPreview', () => {
  it('summarises system prompt, history, files and remote paths', () => {
    const preview = buildContextPreview({
      provider: 'DeepSeek',
      model: 'deepseek-chat',
      systemPrompt: 'x'.repeat(40),
      messages: [
        { role: 'user', content: 'y'.repeat(40) },
        { role: 'assistant', content: 'z'.repeat(40) }
      ],
      files: ['package.json', 'src/index.ts'],
      remotePaths: ['/opt/sepehr-motor']
    })

    expect(preview.provider).toBe('DeepSeek')
    expect(preview.model).toBe('deepseek-chat')
    expect(preview.included.map((section) => section.key)).toEqual([
      'system',
      'history',
      'files',
      'remote'
    ])
    expect(preview.tokens).toBeGreaterThan(30)
    expect(preview.blockedFiles).toEqual([])
    expect(preview.excluded).toEqual(EXCLUDED_ALWAYS)
  })

  it('withholds secret files from the context', () => {
    const preview = buildContextPreview({
      model: 'deepseek-chat',
      messages: [],
      files: ['src/index.ts', '.env', 'certs/server.key'],
      remotePaths: ['/opt/app/.env']
    })

    expect(preview.blockedFiles).toEqual(['.env', 'certs/server.key'])
    expect(preview.included.find((s) => s.key === 'files')?.label).toBe('Files: src/index.ts')
    expect(preview.included.find((s) => s.key === 'remote')).toBeUndefined()
  })

  it('estimates zero tokens and omits empty sections', () => {
    const preview = buildContextPreview({ model: 'm', messages: [] })
    expect(preview.tokens).toBe(0)
    expect(preview.included).toEqual([])
  })
})

describe('formatContextPreview', () => {
  it('renders included and excluded sections as text', () => {
    const preview = buildContextPreview({
      provider: 'DeepSeek',
      model: 'deepseek-chat',
      systemPrompt: 'a'.repeat(400),
      messages: [{ role: 'user', content: 'b'.repeat(800) }]
    })
    const text = formatContextPreview(preview)
    expect(text).toContain('Context to be sent')
    expect(text).toContain('Provider: DeepSeek')
    expect(text).toContain('Tokens (estimated):')
    expect(text).toContain('System prompt (100 tokens)')
    expect(text).toContain('Chat history (200 tokens)')
    expect(text).toContain('NOT included:')
    expect(text).toContain('.env and other secret files')
  })
})
