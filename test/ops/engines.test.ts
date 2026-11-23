import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * v4.3.17 — REL-6.
 *
 * `engines.node` said `>= 20` while the locked toolchain needs 22.12 (jsdom), and both the dev machine and CI run on
 * 22/24. A contributor who trusted `engines` installed a Node the suite cannot run on.
 */
const root = process.cwd()

function manifest(): { engines?: { node?: string } } {
  return JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { engines?: { node?: string } }
}

describe('the declared Node floor matches the toolchain (v4.3.17)', () => {
  it('declares at least 22.12', () => {
    const range = manifest().engines?.node ?? ''
    expect(range).toBe('>=22.12.0')
  })

  it('pins the same major in .nvmrc, so a new checkout lands on a working Node', () => {
    const nvmrc = readFileSync(join(root, '.nvmrc'), 'utf8').trim()
    const floor = />=(\d+)\.(\d+)\.(\d+)/.exec(manifest().engines?.node ?? '')
    expect(floor).not.toBeNull()
    const major = Number(floor![1])
    expect(Number(nvmrc.replace(/^v/, '').split('.')[0])).toBe(major)
  })
})
