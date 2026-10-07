import { describe, it, expect } from 'vitest'
import {
  compressCodeBlock,
  compressMessage,
  compressMessages,
  compressText
} from '@core/agent/context-compressor'
import type { ChatMessage } from '@shared/types'

describe('compressCodeBlock', () => {
  it('removes full-line comments and blank lines but keeps code', () => {
    const code = ['// header comment', '', 'const a = 1', '', '# shebang-ish', 'const b = 2', ''].join(
      '\n'
    )
    const out = compressCodeBlock(code, { maxCodeBlockLines: 0 })
    expect(out).not.toContain('header comment')
    expect(out).not.toContain('shebang-ish')
    expect(out.trim().split('\n')).toEqual(['const a = 1', 'const b = 2'])
  })

  it('strips trailing // comments but preserves URLs', () => {
    const out = compressCodeBlock('const url = "https://example.test/x" // note\nconst y = 1\n')
    expect(out).toContain('https://example.test/x')
    expect(out).not.toContain('// note')
  })

  it('elides very long blocks, keeping head and tail', () => {
    const code = Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n')
    const out = compressCodeBlock(code, { maxCodeBlockLines: 4, stripBlankLines: false })
    const lines = out.trim().split('\n')
    expect(lines).toHaveLength(5) // 2 head + marker + 2 tail
    expect(lines[2]).toContain('16 lines elided')
    expect(lines[0]).toBe('line 0')
    expect(lines[4]).toBe('line 19')
  })
})

describe('compressText', () => {
  it('compresses each fenced block and collapses excess blank lines', () => {
    const text = ['Intro', '', '', '', '```js', '// c', 'const a = 1', '', '```', '', 'Outro'].join(
      '\n'
    )
    const out = compressText(text)
    expect(out).toContain('```js')
    expect(out).toContain('const a = 1')
    expect(out).not.toContain('// c')
    expect(out).not.toContain('\n\n\n')
  })

  it('deduplicates identical code blocks', () => {
    const block = '```ts\nconst shared = 1\n```'
    const out = compressText(`${block}\n\nbetween\n\n${block}`)
    expect(out.match(/const shared = 1/g)).toHaveLength(1)
    expect(out).toContain('[duplicate code block omitted]')
  })
})

describe('compressMessage', () => {
  it('returns the same instance when there is nothing to change', () => {
    const message: ChatMessage = { role: 'user', content: 'plain prose only' }
    expect(compressMessage(message)).toBe(message)
  })

  it('preserves role and tool calls while compressing content', () => {
    const message: ChatMessage = {
      role: 'assistant',
      content: '```js\n// gone\nlet x = 1\n```',
      toolCalls: [{ id: '1', name: 'read_file', arguments: '{"path":"a"}' }]
    }
    const out = compressMessage(message)
    expect(out).not.toBe(message)
    expect(out.role).toBe('assistant')
    expect(out.toolCalls).toEqual(message.toolCalls)
    expect(out.content).not.toContain('// gone')
  })

  it('compresses a list immutably', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: '```py\n# c\nprint(1)\n```' },
      { role: 'assistant', content: 'ok' }
    ]
    const out = compressMessages(messages)
    expect(out).toHaveLength(2)
    expect(out[0].content).not.toContain('# c')
    expect(out[1]).toBe(messages[1])
    expect(messages[0].content).toContain('# c') // original untouched
  })
})
