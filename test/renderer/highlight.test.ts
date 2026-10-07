import { describe, it, expect } from 'vitest'
import { languageOf, tokenize } from '../../src/renderer/src/lib/highlight'

describe('languageOf', () => {
  it('maps common extensions to a language family', () => {
    expect(languageOf('src/app.ts')).toBe('js')
    expect(languageOf('main.py')).toBe('py')
    expect(languageOf('styles.css')).toBe('css')
    expect(languageOf('README.md')).toBe('md')
    expect(languageOf('unknown.xyz')).toBe('plain')
  })
})

describe('tokenize', () => {
  it('tags keywords, strings and comments', () => {
    const tokens = tokenize('const name = "ada" // hi', 'js')
    const byType = (type: string): string[] =>
      tokens.filter((token) => token.type === type).map((token) => token.text)

    expect(byType('keyword')).toContain('const')
    expect(byType('string')).toEqual(['"ada"'])
    expect(byType('comment')).toEqual(['// hi'])
  })

  it('uses # for python comments', () => {
    const tokens = tokenize('x = 1  # note', 'py')
    expect(tokens.find((token) => token.type === 'comment')?.text).toBe('# note')
  })

  it('recognises numbers', () => {
    const tokens = tokenize('return 42', 'js')
    expect(tokens.find((token) => token.type === 'number')?.text).toBe('42')
  })

  it('reconstructs the original line from its tokens', () => {
    const line = 'function f(a) { return `${a}` }'
    const rebuilt = tokenize(line, 'js')
      .map((token) => token.text)
      .join('')
    expect(rebuilt).toBe(line)
  })

  it('treats unknown languages as plain text', () => {
    const tokens = tokenize('hello world', 'plain')
    expect(tokens.map((token) => token.text).join('')).toBe('hello world')
  })
})
