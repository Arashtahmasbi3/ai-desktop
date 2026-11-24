import { describe, expect, it } from 'vitest'
import { normalizeDeliverables } from '../../src/shared/deliverable'
import { PresentToolExecutor, presentTool } from '../../src/core/tools/present-tool'
import type { AgentAction } from '../../src/shared/agent'

/**
 * T11 — `present`.
 *
 * "Here is your file" must never mean "here is /etc": the list is validated before it is stored, and the refusal names
 * the item. The executor is tested against an in-memory store so the rules, not the file, are what is pinned.
 */
function action(files: unknown, valid = true): AgentAction {
  const args = { files }
  return {
    id: 'a1',
    name: 'present',
    arguments: args,
    rawArguments: JSON.stringify(args),
    signature: 'present',
    valid
  }
}

class MemoryStore {
  list = { version: 1 as const, updatedAt: 0, items: [] as Array<{ path: string; description: string }> }
  writes = 0
  async read() {
    return this.list
  }
  async write(list: typeof this.list) {
    this.writes += 1
    this.list = list
  }
}

describe('normalizeDeliverables (T11)', () => {
  it('accepts workspace-relative files and keeps the descriptions', () => {
    const result = normalizeDeliverables([{ path: 'out/report.docx', description: 'گزارش' }], 1_000)

    expect(result.ok).toBe(true)
    expect(result.list.items).toEqual([{ path: 'out/report.docx', description: 'گزارش' }])
    expect(result.list.updatedAt).toBe(1_000)
  })

  it('normalizes windows separators', () => {
    const result = normalizeDeliverables([{ path: 'out\\report.xlsx' }], 1)
    expect(result.list.items[0]!.path).toBe('out/report.xlsx')
  })

  it('refuses an absolute path, a drive path and a traversal', () => {
    expect(normalizeDeliverables([{ path: '/etc/passwd' }], 1).ok).toBe(false)
    expect(normalizeDeliverables([{ path: 'C:/Windows/system32' }], 1).ok).toBe(false)
    expect(normalizeDeliverables([{ path: '../secret.txt' }], 1).ok).toBe(false)
    expect(normalizeDeliverables([{ path: 'a/../../b' }], 1).ok).toBe(false)
  })

  it('refuses an empty list, an empty path and an over-long description', () => {
    expect(normalizeDeliverables([], 1).ok).toBe(false)
    expect(normalizeDeliverables([{ path: '  ' }], 1).ok).toBe(false)
    expect(normalizeDeliverables([{ path: 'a.txt', description: 'x'.repeat(201) }], 1).ok).toBe(false)
  })

  it('caps the list at twenty', () => {
    const many = Array.from({ length: 21 }, (_, index) => ({ path: `f${index}.txt` }))
    expect(normalizeDeliverables(many, 1).ok).toBe(false)
  })
})

describe('PresentToolExecutor (T11)', () => {
  it('stores the list and names the files back', async () => {
    const store = new MemoryStore()
    const executor = new PresentToolExecutor(store, () => 2_000)

    const result = await executor.execute(action([{ path: 'out/a.txt', description: 'a' }]))

    expect(result.ok).toBe(true)
    expect(result.output).toContain('out/a.txt')
    expect(store.writes).toBe(1)
  })

  it('refuses without writing', async () => {
    const store = new MemoryStore()
    const executor = new PresentToolExecutor(store, () => 2_000)

    const result = await executor.execute(action([{ path: '../escape' }]))

    expect(result.ok).toBe(false)
    expect(result.code).toBe('invalid_arguments')
    expect(store.writes).toBe(0)
  })

  it('refuses malformed arguments', async () => {
    const store = new MemoryStore()
    const executor = new PresentToolExecutor(store, () => 2_000)
    const result = await executor.execute(action([], false))
    expect(result.code).toBe('invalid_arguments')
  })

  it('ships a schema that requires files', () => {
    expect(presentTool.parameters.required).toEqual(['files'])
  })
})
