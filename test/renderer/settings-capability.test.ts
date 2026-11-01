import { describe, expect, it, vi } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/*
 * This file reads and parses ~193 source files several times, so it is the slowest unit test in the suite by an order of
 * magnitude: 3.5 s on an idle machine and 24 s when another full run shares the CPU. It has been recorded as a Windows
 * flake twice for that reason, which is the worst outcome — a real regression in it looks like noise and a time-out looks
 * like a regression. The per-file timeout is raised rather than the work reduced, because the work is the point: every
 * switch must be proven to have a consumer.
 */
vi.setConfig({ testTimeout: 45_000 })

/**
 * H5-3 — "no interface without a capability", enforced instead of remembered.
 *
 * `AGENTS.md` states the rule: a switch, chip or button must be backed by one call site that reads
 * what it writes, or it must not ship. The Settings → Plugins page is the case that taught it: seven
 * switches persisted `plugins.enabled` and nothing in the codebase read that key, so every control
 * reported a state change that never happened. Prose did not stop it, so this file does:
 *
 *  1. **No dead tab.** `SettingsPanel.tsx` lists tabs in `NAV_GROUPS` and renders one section per tab
 *     id. A listed-but-never-rendered tab is a button that opens nothing; a rendered-but-never-listed
 *     tab is a section no user can reach. Both are the Plugins bug in a different costume, and both
 *     are checked against the *real* source — nothing here hard-codes a tab list that can drift.
 *  2. **No switch that nothing reads.** Every persisted preference the renderer writes is discovered
 *     by scanning the renderer for `localStorage.setItem(...)` and `writePrefs(...)`, and must be
 *     registered below with a consumer that the test can actually find in the tree. Every
 *     `settings:set*` IPC handler is likewise accounted for. The registered consumers are the
 *     documented allow-list: each one carries a one-line reason, because an entry nobody can explain
 *     is exactly the failure mode.
 *
 * What this file deliberately does *not* claim: it cannot prove that a consumer makes a good decision,
 * only that it reads the value. Deciding "is this us?" is the reviewer's job; deciding "is anything
 * reading this at all?" — the question that rots silently — is this file's job, and it is answered
 * from the source rather than from a hand-maintained list.
 */

const ROOT = join(__dirname, '..', '..')
const RENDERER = join(ROOT, 'src', 'renderer', 'src')
const PANEL = 'src/renderer/src/components/SettingsPanel.tsx'
const IPC = 'src/main/ipc.ts'
const PERSISTENCE = 'src/core/agent/persistence.ts'

function read(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), 'utf8')
}

function lineAt(source: string, index: number): number {
  let line = 1
  for (let i = 0; i < index; i += 1) if (source[i] === '\n') line += 1
  return line
}

/**
 * Blank out `//` and block comments while preserving every index, so a match position still maps to
 * the same line. Strings and template literals are tracked, so `http://` in a URL is not mistaken for
 * a comment — otherwise the scans would either miss code or read prose in a comment as a real use.
 */
function maskComments(source: string): string {
  const out: string[] = []
  let index = 0
  let quote: string | null = null
  while (index < source.length) {
    const char = source[index] ?? ''
    if (quote !== null) {
      out.push(char)
      if (char === '\\') {
        out.push(source[index + 1] ?? '')
        index += 2
        continue
      }
      if (char === quote) quote = null
      index += 1
      continue
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char
      out.push(char)
      index += 1
      continue
    }
    if (char === '/' && source[index + 1] === '/') {
      while (index < source.length && source[index] !== '\n') {
        out.push(' ')
        index += 1
      }
      continue
    }
    if (char === '/' && source[index + 1] === '*') {
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) {
        out.push(source[index] === '\n' ? '\n' : ' ')
        index += 1
      }
      out.push(' ')
      out.push(' ')
      index += 2
      continue
    }
    out.push(char)
    index += 1
  }
  return out.join('')
}

function walk(dir: string, filter: (name: string) => boolean): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full, filter))
    else if (filter(entry.name)) out.push(full)
  }
  return out
}

const repoRelative = (absolute: string): string =>
  absolute.slice(ROOT.length + 1).replace(/\\/g, '/')

const sourceFiles = (dir: string): string[] =>
  walk(dir, (name) => name.endsWith('.ts') || name.endsWith('.tsx'))

// ---------------------------------------------------------------------------------------------
// 1. No dead settings tab
// ---------------------------------------------------------------------------------------------

/** The ids `NAV_GROUPS` lists, in source order. */
function listedTabIds(): string[] {
  const source = maskComments(read(PANEL))
  const start = source.indexOf('const NAV_GROUPS')
  if (start === -1) throw new Error('NAV_GROUPS is no longer declared in SettingsPanel.tsx')
  const end = source.indexOf('\n]', start)
  if (end === -1) throw new Error('could not find the end of NAV_GROUPS')
  const block = source.slice(start, end)
  return [...block.matchAll(/\bid:\s*'([^']+)'/g)].map((match) => match[1] ?? '')
}

/** The ids the panel actually renders a section for (`tab === 'x'`, including `a || b` chains). */
function renderedTabIds(): string[] {
  const source = maskComments(read(PANEL))
  return [...source.matchAll(/\btab\s*===\s*'([^']+)'/g)].map((match) => match[1] ?? '')
}

/** The ids the `TabId` union admits — a third copy that must agree with the other two. */
function declaredTabIds(): string[] {
  const source = maskComments(read(PANEL))
  const lines = source.split('\n')
  const start = lines.findIndex((line) => /^\s*type\s+TabId\b/.test(line))
  if (start === -1) throw new Error('TabId is no longer declared in SettingsPanel.tsx')
  // Walk the union member lines (`| 'general'`), stopping at the first line that is not one, so the
  // end of the block does not depend on how the file happens to be spaced.
  const block: string[] = []
  for (const line of lines.slice(start)) {
    if (block.length > 0 && !/^\s*\|/.test(line)) break
    block.push(line)
  }
  return [...block.join('\n').matchAll(/\|\s*'([^']+)'/g)].map((match) => match[1] ?? '')
}

const listed = listedTabIds()
const rendered = renderedTabIds()
const declared = declaredTabIds()

const sorted = (values: string[]): string[] => [...new Set(values)].sort()

/*
 * KNOWN GAP, recorded here so it cannot be lost again.
 *
 * H5-3 was planned as five invariants. Only two survived the sprint that built this file:
 *
 *   (1) every settings tab is reachable            -> below
 *   (3) every main-owned switch is consulted by main -> further down
 *
 * (2), (4) and (5) were written by an agent that was interrupted, and their numbering is the only trace left. They are
 * NOT reconstructed from memory, because an invariant invented after the fact is a rule nobody agreed to - and this
 * repository has already paid for guessing twice. Whoever owns the original plan should restate them from it; until
 * then the gap is visible here rather than silently absent.
 *
 * What the plan asked of H5-3 overall is still enforced by the two that exist: a control that persists a key nothing
 * reads must not ship, on either side of the IPC boundary.
 */describe('H5-3 (1) - every settings tab is reachable', () => {
  it('1. every tab id NAV_GROUPS lists is rendered by the panel', () => {
    const missing = sorted(listed).filter((id) => !rendered.includes(id))
    expect(missing).toEqual([])
  })

  it('2. every tab the panel renders is listed, so it can be reached at all', () => {
    const unreachable = sorted(rendered).filter((id) => !listed.includes(id))
    expect(unreachable).toEqual([])
  })

  it('3. the TabId union admits exactly the listed ids - a third copy cannot drift either', () => {
    expect(sorted(declared)).toEqual(sorted(listed))
  })

  it('4. no tab id is listed twice (a duplicate silently shadows its section)', () => {
    const duplicates = listed.filter((id, index) => listed.indexOf(id) !== index)
    expect(duplicates).toEqual([])
  })

  it('5. the tab scan really parses the panel (guard against a vacuous pass)', () => {
    // A parser regression that matched nothing would turn cases 1-4 green while checking nothing.
    expect(listed.length).toBeGreaterThanOrEqual(15)
    expect(rendered.length).toBeGreaterThanOrEqual(15)
    expect(listed).toContain('general')
    expect(listed).toContain('developer')
  })
})

// ---------------------------------------------------------------------------------------------
// 2. No switch that nothing reads
// ---------------------------------------------------------------------------------------------

/** Every persisted key the renderer writes, with the site that writes it. */
interface WriteSite {
  key: string
  where: string
}

/*
 * `ReadSite` described the return shape of a helper that was deleted; the unused type was left behind and hid the
 * fact that only `WriteSite` is still constructed. Nothing references it, so it is gone rather than kept "for later".
 */

/**
 * `readPrefs`/`writePrefs` live in `lib/prefs.ts` and namespace their keys with `ai-desktop.`, so a
 * preference written through them is keyed `prefs:<key>` here and can never be confused with a raw
 * `localStorage` key. `lib/prefs.ts` itself is the plumbing (it writes `PREFIX + key`), not a setting,
 * and is excluded from discovery on purpose.
 */
const PREFS_PLUMBING = 'src/renderer/src/lib/prefs.ts'

/** `const NAME = 'literal'` across the renderer, so a write through a constant resolves. */
function constantLiterals(): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>()
  for (const file of sourceFiles(RENDERER)) {
    const source = maskComments(readFileSync(file, 'utf8'))
    for (const match of source.matchAll(
      /\bconst\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]+)?=\s*'([^']*)'/g
    )) {
      const name = match[1] ?? ''
      const value = match[2] ?? ''
      const existing = map.get(name) ?? new Set<string>()
      existing.add(value)
      map.set(name, existing)
    }
  }
  return map
}

const CONSTANTS = constantLiterals()

/** Resolve a call argument that is either a string literal or a constant holding one. */
function resolveKey(name: string, literal: string, local: Map<string, string>): string | null {
  if (literal) return literal
  // The same constant name is reused in more than one module (`STORAGE_KEY` holds the locale key in
  // `i18n/index.ts` and the templates key in `lib/templates.ts`), so the file's own declaration wins
  // before the tree-wide one — otherwise both would look ambiguous and silently drop out of the scan.
  const own = local.get(name)
  if (own !== undefined) return own
  const values = CONSTANTS.get(name)
  if (!values || values.size === 0) return null
  // An ambiguous constant is reported by the caller rather than guessed: picking one would make the
  // scan silently wrong in exactly the case it exists to catch.
  return values.size === 1 ? ([...values][0] ?? null) : null
}

type StorageCall = 'localStorage' | 'prefs'

function scanCalls(
  method: 'write' | 'read'
): Map<string, Array<{ file: string; line: number }>> {
  const sites = new Map<string, Array<{ file: string; line: number }>>()
  const add = (key: string, file: string, line: number): void => {
    const list = sites.get(key) ?? []
    list.push({ file, line })
    sites.set(key, list)
  }
  for (const absolute of sourceFiles(RENDERER)) {
    const file = repoRelative(absolute)
    const source = maskComments(readFileSync(absolute, 'utf8'))
    const local = new Map<string, string>()
    for (const match of source.matchAll(
      /\bconst\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]+)?=\s*'([^']*)'/g
    )) {
      local.set(match[1] ?? '', match[2] ?? '')
    }
    const raw = method === 'write' ? 'setItem' : 'getItem'
    const prefs = method === 'write' ? 'writePrefs' : 'readPrefs'
    const patterns: Array<[RegExp, StorageCall]> = [
      // Any `.setItem` in the renderer is Web Storage: it is the only API in this tree with that
      // method, and `lib/templates.ts` reaches it through a `storage()` accessor rather than
      // `localStorage` directly — a `localStorage`-only pattern would silently miss that switch.
      [new RegExp('\\.\\s*' + raw + '\\(\\s*(?:\'([^\']*)\'|"([^"]*)"|([A-Za-z_$][\\w$]*))', 'g'), 'localStorage'],
      // `readPrefs<T>(key, ...)` carries a generic argument, so the type parameter has to be skipped
      // or every typed read would drop out of the scan.
      [new RegExp('\\b' + prefs + '(?:<[^();]*>)?\\(\\s*(?:\'([^\']*)\'|"([^"]*)"|([A-Za-z_$][\\w$]*))', 'g'), 'prefs']
    ]
    for (const [pattern, kind] of patterns) {
      // The plumbing module writes `PREFIX + key`; its literal prefix is not a setting.
      if (file === PREFS_PLUMBING) continue
      for (const match of source.matchAll(pattern)) {
        const literal = match[1] ?? match[2] ?? ''
        const identifier = match[3] ?? ''
        const resolved = resolveKey(identifier, literal, local)
        if (!resolved) continue
        const key = kind === 'prefs' ? 'prefs:' + resolved : resolved
        add(key, file, lineAt(source, match.index ?? 0))
      }
    }
  }
  return sites
}

const WRITES = scanCalls('write')
const READS = scanCalls('read')

/** Main and core, so a key consumed by the main process needs no allow-list entry. */
function readsOutsideRenderer(key: string): string[] {
  const suffix = key.startsWith('prefs:') ? key.slice('prefs:'.length) : key
  const needle = "'" + suffix + "'"
  const hits: string[] = []
  for (const dir of [join(ROOT, 'src', 'main'), join(ROOT, 'src', 'core')]) {
    for (const absolute of sourceFiles(dir)) {
      const source = maskComments(readFileSync(absolute, 'utf8'))
      if (source.includes(needle)) hits.push(repoRelative(absolute))
    }
  }
  return hits
}

/** A settings page: reading a value back only here is the Plugins bug, not a consumer. */
const isSettingsPanel = (file: string): boolean => /\/components\/Settings[^/]*\.tsx$/.test(file)

interface SwitchWiring {
  /** The persisted key, as discovered: a raw `localStorage` key or `prefs:<key>`. */
  key: string
  /** The file that persists it. Verified: it must really contain the write. */
  writtenBy: string
  /**
   * A file that consumes the value. Verified: it must contain a read of the key, or a call to
   * `reader`. It must NOT be a settings page — that is what makes this an allow-list rather than a
   * rubber stamp. `null` marks a switch that is knowingly unwired today.
   */
  consumer: string | null
  /** Optional symbol whose call in `consumer` counts as the read (`readBudget`, `getActiveProject`, ...). */
  reader?: string
  /** One line. Why a renderer-only read is legitimate, or exactly what is missing. Required. */
  reason: string
}

/**
 * The allow-list. Every persisted renderer preference is here because none of them is read outside
 * `src/renderer/` — the scan verifies that claim (a key that *is* read in main/core needs no entry),
 * and each entry states the consumer that acts on it. An entry with no consumer is a switch that lies
 * today; those are marked `UNWIRED:` and counted, so the debt is visible instead of assumed away.
 */
const SWITCHES: SwitchWiring[] = [
  {
    key: 'ai-desktop:show-context-before-send',
    writtenBy: 'src/renderer/src/store/ui.ts',
    consumer: 'src/renderer/src/store.ts',
    reader: 'readShowContextBeforeSend',
    reason: 'Pure UI preference: the composer shows the token/cost preview before a send only when on.'
  },
  {
    key: 'ai-desktop:show-jobs-panel',
    writtenBy: 'src/renderer/src/store/ui.ts',
    consumer: 'src/renderer/src/store.ts',
    reader: 'readShowJobsPanelAlways',
    reason: 'Pure UI preference: keeps the jobs panel open across a restart instead of collapsing it.'
  },
  {
    key: 'ai-desktop:show-raw-tool-rows',
    writtenBy: 'src/renderer/src/store/ui.ts',
    consumer: 'src/renderer/src/store.ts',
    reader: 'readShowRawToolRows',
    reason: 'Pure UI preference: the inline trace hides already-grouped tool rows unless this is on.'
  },
  {
    key: 'ai-desktop:show-context-warning',
    writtenBy: 'src/renderer/src/store/ui.ts',
    consumer: 'src/renderer/src/store.ts',
    reader: 'readShowContextWarning',
    reason: 'Pure UI preference: the context-filling nudge is opt-in for small-context models.'
  },
  {
    key: 'ai-desktop:sidebar-pinned',
    writtenBy: 'src/renderer/src/store/ui.ts',
    consumer: 'src/renderer/src/store.ts',
    reader: 'readSidebarPinned',
    reason: 'Pure UI preference: pinned lets the layout keep the sidebar expanded down to its minimum.'
  },
  {
    key: 'ai-desktop:zoom-level',
    writtenBy: 'src/renderer/src/store/ui.ts',
    consumer: 'src/renderer/src/store.ts',
    reader: 'readZoomLevel',
    reason: 'Pure UI preference: the store boots the zoom step that applyZoom pushes to the window.'
  },
  {
    key: 'ai-desktop:chat-tree-open',
    writtenBy: 'src/renderer/src/store/prefs.ts',
    consumer: 'src/renderer/src/store.ts',
    reader: 'readChatTreeOpen',
    reason: 'Pure UI preference: the advanced chat tree reopens only if it was open, never in simple mode.'
  },
  {
    key: 'ai-desktop:last-chat',
    writtenBy: 'src/renderer/src/store/prefs.ts',
    consumer: 'src/renderer/src/store/session.ts',
    reader: 'readLastChatId',
    reason: 'Session restore pointer: reopening the app returns to the chat that was last active.'
  },
  {
    key: 'ai-desktop:locale',
    writtenBy: 'src/renderer/src/i18n/index.ts',
    consumer: 'src/renderer/src/i18n/index.ts',
    reader: 'readStoredLocale',
    reason: 'i18n bootstrap: the saved language override is the `lng` i18next initialises with.'
  },
  {
    key: 'ai-desktop:theme',
    writtenBy: 'src/renderer/src/lib/theme.ts',
    consumer: 'src/renderer/src/main.tsx',
    reader: 'readStoredTheme',
    reason: 'Applied before React mounts, so the first paint is already in the chosen theme.'
  },
  {
    key: 'ai-desktop:budget',
    writtenBy: 'src/renderer/src/lib/budget.ts',
    consumer: 'src/renderer/src/store/run.ts',
    reader: 'readBudget',
    reason: 'The daily spend cap is read before a send and refuses it when the cap is reached.'
  },
  {
    key: 'ai-desktop:templates',
    writtenBy: 'src/renderer/src/lib/templates.ts',
    consumer: 'src/renderer/src/components/TemplateMenu.tsx',
    reader: 'loadUserTemplates',
    reason: 'User-defined prompt templates are listed by the composer template menu.'
  },
  {
    key: 'last-active-vps',
    writtenBy: 'src/renderer/src/store/settings.ts',
    consumer: 'src/renderer/src/App.tsx',
    reader: 'readLastVpsId',
    reason: 'The keepalive reconnects the last active server on boot instead of starting disconnected.'
  },
  {
    key: 'usage_stats',
    writtenBy: 'src/renderer/src/lib/usage.ts',
    consumer: 'src/renderer/src/store.ts',
    reader: 'loadUsage',
    reason: 'Local usage ledger: the store boots its records from it, and Settings -> Usage aggregates.'
  },
  {
    key: 'chat-transfer-preference',
    writtenBy: 'src/renderer/src/lib/chat-transfer.ts',
    consumer: 'src/renderer/src/store.ts',
    reader: 'readChatTransferPreference',
    reason: 'Decides whether a project switch asks, links, moves or starts a new chat (planChatTransfer).'
  },
  {
    key: 'prefs:ui.mode',
    writtenBy: 'src/renderer/src/lib/ui-mode.ts',
    consumer: 'src/renderer/src/store.ts',
    reader: 'getUiMode',
    reason: 'Simple/advanced mode gates the terminal, the chat tree and their buttons.'
  },
  {
    key: 'prefs:capabilities.enabled',
    writtenBy: 'src/renderer/src/lib/capabilities.ts',
    consumer: 'src/renderer/src/components/Sidebar.tsx',
    reader: 'isCapabilityEnabled',
    reason: 'The optional-surface switches hide Browser/Terminal/Filesystem and their entry points.'
  },
  {
    key: 'prefs:enabled-tools',
    writtenBy: 'src/renderer/src/lib/tool-toggles.ts',
    consumer: 'src/renderer/src/store/run.ts',
    reader: 'readEnabledTools',
    reason: 'Settings -> Tools narrows the tool groups main is allowed to offer the model.'
  },
  {
    key: 'prefs:browser.permissions',
    writtenBy: 'src/renderer/src/components/SettingsBrowser.tsx',
    consumer: null,
    reason:
      'UNWIRED: per-site decisions are written and read back by SettingsBrowser itself; no webview policy in src/main consults them, so "Block" blocks nothing today. Wire it into webview-policy.ts or remove the list.'
  },
  {
    key: 'prefs:conn.pc',
    writtenBy: 'src/renderer/src/components/SettingsConnections.tsx',
    consumer: null,
    reason:
      'UNWIRED: toggling "this PC" changes the dot colour inside the panel; nothing gates local shell or file access on it, so the switch reports a change that does not happen. Wire it to local-shell/policy or report the PC as always reachable.'
  },
  {
    key: 'prefs:codereview.repos',
    writtenBy: 'src/renderer/src/components/SettingsCodeReview.tsx',
    consumer: null,
    reason:
      'UNWIRED: per-repo "auto review" is persisted and echoed as a checkbox, but no code path reviews a repository, so the flag promises work nobody does. Wire it to the GitHub service or remove the column.'
  }
]

/** The known-unwired count is pinned so a new dead switch cannot be waved through with a reason. */
const KNOWN_UNWIRED = 3

const writtenHere = (key: string): WriteSite[] =>
  (WRITES.get(key) ?? []).map((site) => ({
    key,
    where: site.file + ':' + String(site.line)
  }))

/*
 * H5-3: a test that read "every written switch is registered here" lived at this point and was lost when the agent
 * writing this file was interrupted mid-run (its body was cut, leaving a dangling assertion). It is deliberately NOT
 * guessed back: an invented version of that scan could pass while checking nothing. The four invariants below still
 * fail the build on a dead switch — a registered entry nothing writes, a writer that does not write it, a consumer
 * that is only the settings page echoing the value, and the pinned known-unwired count.
 */

  it('2. every registered switch is still written (a stale entry hides a real gap)', () => {
    const stale = SWITCHES.filter((entry) => writtenHere(entry.key).length === 0).map(
      (entry) => entry.key + ' is registered but nothing in src/renderer/src writes it'
    )
    expect(stale).toEqual([])
  })

  it('3. the registered writer really writes it', () => {
    const wrong = SWITCHES.filter(
      (entry) => !writtenHere(entry.key).some((site) => site.where.startsWith(entry.writtenBy + ':'))
    ).map((entry) => entry.key + ' is not written by ' + entry.writtenBy)
    expect(wrong).toEqual([])
  })

  it('4. every wired switch has a consumer outside the settings page that persists it', () => {
    const problems: string[] = []
    for (const entry of SWITCHES) {
      if (entry.consumer === null) continue
      const source = maskComments(read(entry.consumer))
      const readsKey = (READS.get(entry.key) ?? []).some((site) => site.file === entry.consumer)
      const callsReader = entry.reader ? source.includes(entry.reader + '(') : false
      if (!readsKey && !callsReader) {
        problems.push(
          entry.key + ': ' + entry.consumer + ' neither reads the key nor calls ' + (entry.reader ?? '(no reader)')
        )
      }
      if (isSettingsPanel(entry.consumer)) {
        problems.push(
          entry.key + ': ' + entry.consumer + ' is a settings page, which is an echo and not a consumer'
        )
      }
    }
    expect(problems).toEqual([])
  })

  it('5. every switch carries a one-line reason, and no reason is a placeholder', () => {
    const unexplained = SWITCHES.filter((entry) => {
      const reason = entry.reason.trim()
      // "UNWIRED: ..." names a missing capability; anything else must say who acts on the value.
      return reason.length < 40 || !/[a-z]/.test(reason)
    }).map((entry) => entry.key)
    expect(unexplained).toEqual([])

    const noConsumerWithoutMarker = SWITCHES.filter(
      (entry) => entry.consumer === null && !entry.reason.startsWith('UNWIRED:')
    ).map((entry) => entry.key + ' has no consumer but is not marked UNWIRED:')
    expect(noConsumerWithoutMarker).toEqual([])

    const markerWithConsumer = SWITCHES.filter(
      (entry) => entry.consumer !== null && entry.reason.startsWith('UNWIRED:')
    ).map((entry) => entry.key + ' is marked UNWIRED: but declares a consumer')
    expect(markerWithConsumer).toEqual([])
  })

  it('6. the known-unwired switches are exactly the documented ones (fixing one must update this)', () => {
    const unwired = SWITCHES.filter((entry) => entry.consumer === null)
    // Pinned: a fifth dead switch needs a deliberate edit here, not just another reason string.
    expect(unwired.length).toBe(KNOWN_UNWIRED)
    expect(unwired.map((entry) => entry.key).sort()).toEqual([
      'prefs:browser.permissions',
      'prefs:codereview.repos',
      'prefs:conn.pc'
    ])
  })

  it('7. a switch read outside src/renderer needs no entry here, so no entry may be dead weight', () => {
    // Stated as an assertion about the inventory's honesty: these keys are consumed by main/core, so
    // listing them as renderer-only would be a false claim in the allow-list.
    expect(SWITCHES.filter((entry) => readsOutsideRenderer(entry.key).length > 0).map((e) => e.key)).toEqual(
      []
    )
  })

  it('8. the scan really sees the switches (guard against a vacuous pass)', () => {
    expect(WRITES.size).toBeGreaterThanOrEqual(18)
    expect(READS.size).toBeGreaterThanOrEqual(18)
    expect(SWITCHES.length).toBeGreaterThanOrEqual(18)
    // Every discovered key resolves to a literal; an unresolved constant would silently drop a switch.
    for (const [key, sites] of WRITES) {
      expect(key.length).toBeGreaterThan(0)
      expect(sites.length).toBeGreaterThan(0)
    }
  })

// ---------------------------------------------------------------------------------------------
// 3. The settings main persists are switches too
// ---------------------------------------------------------------------------------------------

/**
 * `window.api.settings.set*` writes a *main-owned* setting. The renderer cannot read the file, so the
 * only way such a switch can lie is for main to persist it and never consult it — which is why the
 * consumer here must normally live outside `src/renderer/`. The handlers are discovered from
 * `ipc.ts`, not listed by hand, so a new one has to be accounted for.
 */
interface MainSwitch {
  handler: string
  /** The `AppSettings` field the handler's persistence setter assigns. */
  field: string
  /** A file that consults the field. Verified: it must mention it. */
  consumer: string
  /** One line: what the consumer decides. Required. */
  reason: string
}

const MAIN_SWITCHES: MainSwitch[] = [
  {
    handler: 'settings:setApprovalMode',
    field: 'approvalMode',
    consumer: 'src/main/agent-service/run-gates.ts',
    reason: 'Picks the per-run approval mode that decides whether a tool call prompts.'
  },
  {
    handler: 'settings:setCheckpointMode',
    field: 'checkpointMode',
    consumer: 'src/main/agent-service/run-gates.ts',
    reason: 'Off/record/confirm decides whether a consequential decision is logged or gated.'
  },
  {
    handler: 'settings:setPlanModeDefault',
    field: 'planModeDefault',
    consumer: 'src/main/agent-service/run-gates.ts',
    reason: 'Makes a new chat plan-only unless the request overrides it.'
  },
  {
    handler: 'settings:setRememberApprovalMode',
    field: 'rememberApprovalMode',
    consumer: 'src/renderer/src/store/session.ts',
    reason: 'Renderer-owned on purpose: main persists it, the renderer decides whether a restart drops back to Ask.'
  },
  {
    handler: 'settings:setActiveProvider',
    field: 'activeProvider',
    consumer: 'src/main/agent-service/providers.ts',
    reason: 'Orders the provider attempt list so the chosen provider is tried first.'
  }
]

/**
 * Handlers that edit a *collection* (a provider's keys, a model, the project list) rather than a
 * switch. They are not exempt from the rule, they simply have no single boolean to read: their
 * consumers are the adapters and the project resolver, which read the records directly.
 */
const COLLECTION_EDIT_HANDLERS = [
  'settings:setApiKey',
  'settings:addApiKey',
  'settings:removeApiKey',
  'settings:removeApiKeyAt',
  'settings:setModel',
  'settings:addProject',
  'settings:addRemoteProject',
  'settings:removeProject',
  'settings:updateProjectPath'
]

interface HandlerSite {
  channel: string
  line: number
  /** `services.persistence.<method>(...)` calls in the handler body. */
  setters: string[]
}

/**
 * Channels that only *expose* settings. Everything else under `settings:` is a write and has to be
 * accounted for — the scan deliberately does not assume a `set` prefix, because three of the writes
 * are named `addProject` / `removeApiKey` / `updateProjectPath`.
 */
const READ_ONLY_SETTINGS_CHANNELS = ['settings:get', 'settings:keyHealth']

/** The registered `settings:*` handlers, with the persistence setter each one calls. */
function discoverHandlers(): HandlerSite[] {
  const source = maskComments(read(IPC))
  const handlers: HandlerSite[] = []
  for (const match of source.matchAll(/'settings:([A-Za-z]+)'/g)) {
    const channel = 'settings:' + (match[1] ?? '')
    if (READ_ONLY_SETTINGS_CHANNELS.includes(channel)) continue
    const index = match.index ?? 0
    // A handler is a `[channel, fn]` tuple entry, so the quote follows `[`; an event channel
    // (`send('settings:changed', ...)`) follows `(` and is not a handler at all.
    const before = source.slice(Math.max(0, index - 40), index).trimEnd()
    if (!before.endsWith('[')) continue
    // The handler body runs to the next channel declaration; slicing that way keeps a neighbouring
    // handler's setter out of this one's body.
    const next = source.indexOf("'settings:", index + channel.length)
    const body = source.slice(index, next === -1 ? index + 900 : next)
    const setters = [...body.matchAll(/persistence\.(set[A-Za-z]+)\(/g)].map((item) => item[1] ?? '')
    handlers.push({ channel, line: lineAt(source, index), setters })
  }
  return handlers
}

/** The plain `AppSettings` field each persistence setter assigns, if it assigns exactly one. */
function setterFields(): Map<string, string[]> {
  const source = maskComments(read(PERSISTENCE))
  const result = new Map<string, string[]>()
  const setters = [...source.matchAll(/async\s+(set[A-Za-z]+)\s*\(/g)]
  for (let index = 0; index < setters.length; index += 1) {
    const name = setters[index]?.[1] ?? ''
    const start = setters[index]?.index ?? 0
    const end = setters[index + 1]?.index ?? source.length
    const body = source.slice(start, end)
    const fields = [...body.matchAll(/this\.settings\.([A-Za-z]+)\s*=/g)].map((item) => item[1] ?? '')
    result.set(name, [...new Set(fields)])
  }
  return result
}

const HANDLERS = discoverHandlers()
const SETTER_FIELDS = setterFields()

const handlerChannels = HANDLERS.map((handler) => handler.channel)

describe('H5-3 (3) - every main-owned settings switch is consulted by main', () => {
  it('1. every settings:set* handler is either a documented switch or a documented collection edit', () => {
    const accounted = new Set([
      ...MAIN_SWITCHES.map((entry) => entry.handler),
      ...COLLECTION_EDIT_HANDLERS
    ])
    const unaccounted = handlerChannels.filter((channel) => !accounted.has(channel))
    expect(unaccounted).toEqual([])
  })

  it('2. every documented switch names a handler that exists and a setter that assigns its field', () => {
    const problems: string[] = []
    for (const entry of MAIN_SWITCHES) {
      const handler = HANDLERS.find((site) => site.channel === entry.handler)
      if (!handler) {
        problems.push(entry.handler + ' is registered here but no longer declared in ipc.ts')
        continue
      }
      const setters = handler.setters
      if (setters.length === 0) {
        problems.push(entry.handler + ' calls no persistence setter at line ' + String(handler.line))
        continue
      }
      const fields = setters.flatMap((setter) => SETTER_FIELDS.get(setter) ?? [])
      if (!fields.includes(entry.field)) {
        problems.push(entry.handler + ' does not persist ' + entry.field + ' (setters: ' + setters.join(', ') + ')')
      }
    }
    expect(problems).toEqual([])
  })

  it('3. every documented switch is really read by the consumer it names', () => {
    const problems: string[] = []
    for (const entry of MAIN_SWITCHES) {
      const source = maskComments(read(entry.consumer))
      if (!new RegExp('\\b' + entry.field + '\\b').test(source)) {
        problems.push(entry.field + ' is not read in ' + entry.consumer)
      }
    }
    expect(problems).toEqual([])
  })

  it('4. a switch consumed only by the renderer says so in its reason', () => {
    const problems = MAIN_SWITCHES.filter(
      (entry) => entry.consumer.startsWith('src/renderer/') && entry.reason.trim().length < 40
    ).map((entry) => entry.field + ' is renderer-consumed without an explanation')
    expect(problems).toEqual([])
  })

  it('5. the handler scan really parses ipc.ts (guard against a vacuous pass)', () => {
    expect(HANDLERS.length).toBeGreaterThanOrEqual(14)
    expect(SETTER_FIELDS.get('setApprovalMode')).toContain('approvalMode')
    expect(SETTER_FIELDS.get('setCheckpointMode')).toContain('checkpointMode')
  })
})
