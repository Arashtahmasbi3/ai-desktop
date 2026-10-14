import { describe, expect, it } from 'vitest'
import en from '../../src/renderer/src/i18n/en.json'
import {
  TOOL_LABEL_KEYS,
  summarizeActivity,
  toolLabel,
  toolLabelKey
} from '../../src/renderer/src/lib/tool-labels'

/**
 * v2.8.0 — the reported symptom was literal: every surface printed the raw tool name,
 * so a server command always read "Running remote_shell…". These cases keep the label
 * map honest and, more importantly, keep every key it references actually translated —
 * a missing key would render `tools.remoteShell` in the UI, which is worse than the
 * raw name it replaced.
 */
const t = (key: string, params?: Record<string, unknown>): string => {
  const value = key
    .split('.')
    .reduce<unknown>(
      (node, part) =>
        typeof node === 'object' && node !== null
          ? (node as Record<string, unknown>)[part]
          : undefined,
      en
    )
  if (typeof value !== 'string') return `<missing:${key}>`
  return params
    ? value.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(params[name] ?? ''))
    : value
}

describe('tool labels (v2.8.0)', () => {
  it('every mapped tool has a real translation in en.json', () => {
    const missing = Object.entries(TOOL_LABEL_KEYS)
      .filter(([, key]) => {
        const value = key
          .split('.')
          .reduce<unknown>(
            (node, part) =>
              typeof node === 'object' && node !== null
                ? (node as Record<string, unknown>)[part]
                : undefined,
            en
          )
        return typeof value !== 'string' || value.length === 0
      })
      .map(([tool, key]) => `${tool} -> ${key}`)

    expect(missing).toEqual([])
  })

  it('names the tools behind the complaint in words, never as raw identifiers', () => {
    expect(toolLabel('remote_shell', t)).toBe('a command on the server')
    expect(toolLabel('remote_read_file', t)).toBe('a file on the server')
    expect(toolLabel('remote_write_file', t)).toBe('a file on the server')
    expect(toolLabel('run_command', t)).toBe('a command')

    for (const tool of Object.keys(TOOL_LABEL_KEYS)) {
      const label = toolLabel(tool, t)
      expect(label).not.toContain('_')
      expect(label).not.toContain('tools.')
    }
  })

  it('never falls back to a snake_case token for an unknown tool', () => {
    expect(toolLabel('brand_new_tool', t)).toBe('brand new tool')
    expect(toolLabel(undefined, t)).toBe('')
    expect(toolLabelKey('brand_new_tool')).toBe('tools.unknown')
  })
})

describe('summarizeActivity (v2.8.0)', () => {
  it('counts commands, reads, edits and searches separately', () => {
    const summary = summarizeActivity([
      'remote_shell',
      'run_command',
      'read_file',
      'remote_read_file',
      'list_dir',
      'write_file',
      'remote_grep'
    ])

    expect(summary.commands).toBe(2)
    expect(summary.reads).toBe(3)
    expect(summary.edits).toBe(1)
    expect(summary.searches).toBe(1)
    expect(summary.total).toBe(7)
  })

  it('ignores unknown tools and empty entries but still counts them as activity', () => {
    const summary = summarizeActivity(['migrate_project', undefined, ''])
    expect(summary.total).toBe(1)
    expect(summarizeActivity([])).toEqual({ commands: 0, reads: 0, edits: 0, searches: 0, total: 0 })
  })
})
