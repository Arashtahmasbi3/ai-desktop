import { describe, it, expect } from 'vitest'
import {
  EXCLUDED_ALWAYS,
  buildContextPreview,
  formatContextPreview,
  isSecretPath
} from '@shared/context-preview'
import { estimateRawTokens, estimateTrimmedTokens } from '@shared/tokens'

describe('estimateRawTokens', () => {
  it('approximates four characters per token and floors at zero', () => {
    expect(estimateRawTokens('')).toBe(0)
    expect(estimateRawTokens('abcd')).toBe(1)
    expect(estimateRawTokens('a'.repeat(9))).toBe(3)
  })

  it('counts whitespace the trimmed budget estimate ignores', () => {
    // Two names, not one: the preview reports what is really sent, so padding
    // is billed; the composer budget trims it. Merging them would move a number
    // the user already sees in one of the two places.
    expect(estimateRawTokens('   ')).toBe(1)
    expect(estimateTrimmedTokens('   ')).toBe(0)
    expect(estimateRawTokens('  abcd  ')).toBe(2)
    expect(estimateTrimmedTokens('  abcd  ')).toBe(1)
    // Identical for text that is already trimmed.
    expect(estimateRawTokens('abcdefgh')).toBe(estimateTrimmedTokens('abcdefgh'))
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
      remotePaths: ['/opt/demo-project']
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
