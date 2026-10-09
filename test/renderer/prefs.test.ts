import { describe, it, expect } from 'vitest'
import {
  setRepoReview,
  upsertPermission,
  DEFAULT_WEBSITE_DECISION,
  type WebsitePermission
} from '../../src/renderer/src/lib/prefs'
import { filterCatalog, CATALOG } from '../../src/renderer/src/lib/catalog'

describe('prefs helpers', () => {
  it('defaults new website permissions to "ask"', () => {
    expect(DEFAULT_WEBSITE_DECISION).toBe('ask')
    const list = upsertPermission([], 'Example.COM')
    expect(list).toEqual([{ host: 'example.com', decision: 'ask' }])
  })

  it('updates an existing permission instead of duplicating', () => {
    const list: WebsitePermission[] = [{ host: 'a.com', decision: 'ask' }]
    expect(upsertPermission(list, 'a.com', 'block')).toEqual([
      { host: 'a.com', decision: 'block' }
    ])
    expect(upsertPermission(list, '   ', 'allow')).toHaveLength(1)
  })

  it('sets per-repo auto-review config', () => {
    expect(setRepoReview([], 'o/r', true)).toEqual([{ repo: 'o/r', autoReview: true }])
    expect(setRepoReview([{ repo: 'o/r', autoReview: true }], 'o/r', false)).toEqual([
      { repo: 'o/r', autoReview: false }
    ])
  })
})

describe('catalog', () => {
  it('filters by kind and query', () => {
    expect(filterCatalog(CATALOG, 'mcp', '').every((entry) => entry.kind === 'mcp')).toBe(true)
    const hits = filterCatalog(CATALOG, 'plugin', 'git')
    expect(hits.map((entry) => entry.id)).toEqual(['github'])
    expect(filterCatalog(CATALOG, 'app', 'zzz')).toEqual([])
  })
})
