import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * v4.3.17 — UI-10.
 *
 * The chat-tree drawer used physical `left-0` / `border-r`, so in the Persian (RTL) interface it opened from the wrong
 * edge and its divider sat on the wrong side. Direction-aware utilities (`start-0`, `border-e`) follow the document.
 *
 * This is a source contract rather than a render: the assertion is about which utility a class string carries, and a
 * rendered DOM assertion would only restate the same string.
 */
const read = (path: string): string => readFileSync(join(process.cwd(), 'src', 'renderer', 'src', 'components', path), 'utf8')

describe('the chat tree follows the document direction (v4.3.17)', () => {
  it('uses start-0 and border-e instead of left-0 and border-r', () => {
    const source = read('ChatTree.tsx')
    expect(source).toContain('start-0')
    expect(source).toContain('border-e')
    expect(source).not.toContain('left-0')
    expect(source).not.toContain('border-r ')
  })
})
