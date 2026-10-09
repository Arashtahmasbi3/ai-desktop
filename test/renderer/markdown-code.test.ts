import { describe, it, expect } from 'vitest'
import { readCode } from '../../src/renderer/src/lib/markdown-code'

/** Build a minimal hast-like pre>code node for the tests. */
function pre(code: string, language?: string) {
  return {
    tagName: 'pre',
    children: [
      {
        tagName: 'code',
        properties: language ? { className: [`language-${language}`] } : {},
        children: [{ value: code }]
      }
    ]
  }
}

describe('readCode', () => {
  it('reads the code text and language', () => {
    expect(readCode(pre('ls -la\n', 'bash'))).toEqual({ code: 'ls -la', language: 'bash' })
  })

  it('handles a missing language and strips one trailing newline', () => {
    expect(readCode(pre('console.log(1)\n'))).toEqual({
      code: 'console.log(1)',
      language: ''
    })
  })

  it('is empty for a malformed node', () => {
    expect(readCode(undefined)).toEqual({ code: '', language: '' })
  })
})
