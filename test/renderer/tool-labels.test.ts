import { describe, expect, it } from 'vitest'
import en from '../../src/renderer/src/i18n/en.json'
import {
  TOOL_HEADLINE_KEYS,
  TOOL_LABEL_KEYS,
  TOOL_VERBS,
  summarizeActivity,
  summarizeCommand,
  summarizePath,
  toolHeadline,
  toolLabel,
  toolLabelKey,
  truncateMiddle
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

/**
 * v2.8.1 — "remote_shell and these texts are still not fixed."
 *
 * The card and the trace chip were still headed by the raw tool name above a whole
 * pipeline. `summarizeCommand` turns a real shell command into one readable stage
 * (banner echo dropped, quotes honoured, tail kept) and `toolHeadline` turns the
 * tool into a sentence.
 */
const SANDBOX_NET_TEST = `echo "== sandbox net test =="; timeout 8 bash -c 'exec 3<>/dev/tcp/1.1.1.1/443 && echo connected' 2>&1`
const SSH_PROBE =
  'timeout 12 ssh -vv -o BatchMode=yes -o ConnectTimeout=8 -o StrictHostKeyChecking=accept-new root@203.0.113.9 true'
const PORT_SCAN =
  'for p in 22 23 25 53 80 110 143 443 465 587 993 995 1433 1521 3306 3389 5432 5900 6379 8080 8443 9000 9200 27017; do timeout 2 bash -c "</dev/tcp/10.0.0.5/$p" 2>/dev/null && echo "$p open"; done'

describe('summarizeCommand (v2.8.1)', () => {
  it('drops the banner echo and keeps the first real stage of the pipeline', () => {
    const summary = summarizeCommand(SANDBOX_NET_TEST)

    expect(summary.startsWith('timeout 8 bash -c ')).toBe(true)
    expect(summary).not.toContain('sandbox net test')
    // This stage fits the 72-char budget whole, so asserting an ellipsis here (as the
    // first draft did) contradicted `truncateMiddle`'s own contract.
    expect(summary).toBe("timeout 8 bash -c 'exec 3<>/dev/tcp/1.1.1.1/443 && echo connected' 2>&1")
    expect(summary.length).toBeLessThanOrEqual(72)
  })

  it('middle-truncates a long ssh probe so the trailing host survives', () => {
    const summary = summarizeCommand(SSH_PROBE)

    expect(summary.startsWith('timeout 12 ssh -vv ')).toBe(true)
    expect(summary.endsWith('root@203.0.113.9 true')).toBe(true)
    expect(summary).toContain('…')
    expect(summary.length).toBeLessThanOrEqual(72)
  })

  it('leaves a short probe and a redirect untouched', () => {
    expect(summarizeCommand('command -v nc >/dev/null && echo present')).toBe(
      'command -v nc >/dev/null'
    )
    // `2>&1` is a redirect, not a stage separator.
    expect(summarizeCommand('command -v nc >/dev/null 2>&1')).toBe('command -v nc >/dev/null 2>&1')
  })

  it('keeps the head of a long for-loop readable', () => {
    const summary = summarizeCommand(PORT_SCAN)

    expect(summary.startsWith('for p in 22 23 25 ')).toBe(true)
    expect(summary).toContain('…')
    expect(summary.length).toBeLessThanOrEqual(72)
  })

  it('is quote-aware: a quoted pipe or field separator is never split', () => {
    expect(summarizeCommand('echo "a|b" | grep z')).toBe('echo "a|b"')
    // The naive `split('|')` returned `echo "a` — prove it cannot come back.
    expect(summarizeCommand('echo "a|b" | grep z')).not.toBe('echo "a')
    expect(summarizeCommand("awk -F'|' '{print $2}' file")).toBe("awk -F'|' '{print $2}' file")
    expect(summarizeCommand('echo ok && npm run build')).toBe('echo ok')
  })

  it('strips control characters and collapsed whitespace before summarizing', () => {
    expect(summarizeCommand('ls\u0000 -la\n\r\n  /tmp')).toBe('ls -la /tmp')
    expect(summarizeCommand('   ')).toBe('')
  })
})

describe('summarizePath (v2.8.1)', () => {
  it('shortens from the left and never cuts a path segment in half', () => {
    const path = '/srv/apps/demo-project/packages/renderer/src/components/settings/DeveloperPanel.tsx'
    const summary = summarizePath(path)

    expect(summary.startsWith('…/')).toBe(true)
    expect(summary.endsWith('/components/settings/DeveloperPanel.tsx')).toBe(true)
    // Whole segments are dropped, so no half path can appear.
    expect(summary).not.toContain('demo-project')
    expect(summary.length).toBeLessThanOrEqual(72)
  })

  it('returns a short path unchanged', () => {
    expect(summarizePath('/srv/app/src/index.ts')).toBe('/srv/app/src/index.ts')
    expect(summarizePath('')).toBe('')
  })
})

describe('truncateMiddle (v2.8.1)', () => {
  it('keeps the head and the tail with a single ellipsis', () => {
    const text = 'timeout 12 ssh -vv -o BatchMode=yes -o ConnectTimeout=8 root@1.2.3.4'
    const out = truncateMiddle(text, 40)

    expect(out).toHaveLength(40)
    expect(out.startsWith('timeout 12')).toBe(true)
    expect(out.endsWith('1.2.3.4')).toBe(true)
    expect(out.match(/…/g)).toHaveLength(1)
  })

  it('never truncates text that already fits', () => {
    expect(truncateMiddle('ls -la', 40)).toBe('ls -la')
  })
})

describe('toolHeadline (v2.8.1)', () => {
  it('names a remote shell call in words and keeps the raw command', () => {
    const result = toolHeadline(
      { name: 'remote_shell', ok: true, command: SANDBOX_NET_TEST, serverId: 'srv-1' },
      t
    )

    expect(result.headline).toBe('Ran a command on the server')
    expect(result.detail?.startsWith('timeout 8 bash -c ')).toBe(true)
    expect(result.raw).toBe(SANDBOX_NET_TEST)
  })

  it('names a read in words and shortens the path in the detail', () => {
    const path = '/srv/apps/demo-project/packages/renderer/src/components/settings/DeveloperPanel.tsx'
    const result = toolHeadline({ name: 'read_file', ok: true, path }, t)

    expect(result.headline).toBe('Read a file')
    expect(result.detail?.startsWith('…/')).toBe(true)
    expect(result.detail?.endsWith('/DeveloperPanel.tsx')).toBe(true)
    expect(result.raw).toBe(path)
  })

  it('marks a remote read as remote from the tool name alone', () => {
    expect(toolHeadline({ name: 'remote_read_file', ok: true, path: '/opt/app/x.ts' }, t).headline).toBe(
      'Read a file on the server'
    )
    expect(toolHeadline({ name: 'read_file', ok: true, path: '/opt/app/x.ts' }, t).headline).toBe(
      'Read a file'
    )
  })

  it('has a real translation for every headline key', () => {
    const missing = TOOL_HEADLINE_KEYS.filter((key) => t(key).includes('<missing:'))
    expect(missing).toEqual([])
    for (const key of TOOL_HEADLINE_KEYS) expect(t(key)).not.toContain('tools.')
  })

  it('maps every verb and never lets an unknown tool leak a key or an underscore', () => {
    expect(new Set(Object.values(TOOL_VERBS))).toEqual(new Set(['run', 'read', 'write', 'search']))

    const names = [
      'run_command',
      'shell_exec',
      'remote_shell',
      'read_file',
      'remote_read_file',
      'list_dir',
      'write_file',
      'remote_write_file',
      'search_code',
      'remote_grep',
      'brand_new_tool'
    ]

    for (const name of names) {
      const { headline } = toolHeadline({ name, command: 'ls -la' }, t)
      expect(headline.length).toBeGreaterThan(0)
      expect(headline).not.toContain('_')
      expect(headline).not.toContain('tools.')
    }

    expect(toolHeadline({ name: 'brand_new_tool' }, t)).toEqual({
      headline: 'Ran a command',
      detail: undefined,
      raw: undefined
    })
    expect(toolHeadline({}, t).headline).toBe('Ran a command')
  })
})
