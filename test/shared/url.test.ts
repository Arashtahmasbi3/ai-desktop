import { describe, it, expect } from 'vitest'
import { isAllowedUrl, normalizeUrl } from '@shared/url'

describe('normalizeUrl', () => {
  it('prefixes bare hosts with https', () => {
    expect(normalizeUrl('example.com')).toBe('https://example.com/')
  })

  it('keeps explicit http(s) URLs', () => {
    expect(normalizeUrl('http://localhost:3000/app')).toBe('http://localhost:3000/app')
  })

  it('rejects dangerous and non-web schemes', () => {
    expect(normalizeUrl('javascript:alert(1)')).toBeNull()
    expect(normalizeUrl('file:///etc/passwd')).toBeNull()
    expect(normalizeUrl('data:text/html,<h1>x</h1>')).toBeNull()
    expect(normalizeUrl('   ')).toBeNull()
  })
})

describe('isAllowedUrl', () => {
  it('allows http and https only', () => {
    expect(isAllowedUrl('https://example.com')).toBe(true)
    expect(isAllowedUrl('http://127.0.0.1')).toBe(true)
    expect(isAllowedUrl('file:///tmp/x')).toBe(false)
    expect(isAllowedUrl('not a url')).toBe(false)
  })
})
