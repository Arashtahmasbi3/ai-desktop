import { join } from 'node:path'
import { promises as fs } from 'node:fs'
import type { SkillDefinition, SkillSummary, SkillSource } from '@shared/skill'

/**
 * F0-3 — discovery, frontmatter parsing and body reading for `SKILL.md` skills.
 *
 * Three rules govern this file, each pinned by `test/main/skills.test.ts`:
 *
 *  1. **Two roots, one level deep.** `<userData>/skills` and `<projectRoot>/.ai-desktop/skills`
 *     are scanned for `<folder>/SKILL.md`. A folder without one is not a skill, and an entry
 *     that is not a directory is never treated as one.
 *  2. **The filesystem is injected.** Every read goes through `SkillFs`, so a test hands in a
 *     map instead of touching the user's home directory; the default is the real `node:fs`.
 *  3. **The body is read on demand.** Discovery parses frontmatter only and keeps it out of the
 *     summary; `use_skill` is what reads a body, because that is the expensive half.
 *
 * A name is a lookup key, never a path segment. Discovery records the absolute `SKILL.md` path
 * it actually read, and invocation reads only a recorded path — so a name like `../secrets` is
 * simply not in the registry and cannot escape the skills directory (`isSafeSkillName` is the
 * second, redundant guard for that).
 */
export interface SkillDirEntry {
  name: string
  /** False for a file or a symlink: only a directory can hold a `SKILL.md`. */
  directory: boolean
}

/** The filesystem boundary. Injected so tests never read a real home directory. */
export interface SkillFs {
  /** The entries of `dir`, or `[]` when it does not exist. Must not throw for a missing folder. */
  list(dir: string): Promise<SkillDirEntry[]>
  /** The UTF-8 text of `path`, or `null` when it does not exist / cannot be read. */
  read(path: string): Promise<string | null>
}

/** The real filesystem, with "missing" reported as "nothing there" rather than as an error. */
export const nodeSkillFs: SkillFs = {
  async list(dir: string): Promise<SkillDirEntry[]> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true })
      return entries.map((entry) => ({ name: entry.name, directory: entry.isDirectory() }))
    } catch {
      // A missing skills folder is the normal case (most users have none), not a failure.
      return []
    }
  },
  async read(path: string): Promise<string | null> {
    try {
      return await fs.readFile(path, 'utf8')
    } catch {
      return null
    }
  }
}

/** One root to scan, and what a skill found there is attributed to. */
export interface SkillRoot {
  dir: string
  source: SkillSource
}

export interface ParsedSkillDocument {
  /** The frontmatter `name`, when there is one. Absent means "use the folder name". */
  name?: string
  /** The frontmatter `description`, or the first meaningful line of the body. Never empty when the file has text. */
  description: string
  /** Everything after the closing `---`, or the whole file when there is no frontmatter. */
  body: string
}

/**
 * `---` on the first line, a block, then a closing `---`. Anchored at index 0 on purpose: a
 * horizontal rule in the middle of a document must not turn the text above it into metadata.
 */
const FRONTMATTER = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/

/** `key: value` pairs, last one wins. Enough for the two fields a skill actually has. */
function parseFrontmatterFields(block: string): Map<string, string> {
  const fields = new Map<string, string>()
  for (const line of block.split(/\r?\n/)) {
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue
    const match = /^([A-Za-z][A-Za-z0-9_-]*)[ \t]*:[ \t]*(.*)$/.exec(line.trimEnd())
    if (!match) continue
    const value = match[2].trim().replace(/^(['"])(.*)\1$/, '$2')
    fields.set(match[1].toLowerCase(), value)
  }
  return fields
}

/** Flatten to one line and bound it: a description is exposure, so it must stay cheap. */
export function oneLineDescription(text: string, limit = 200): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= limit ? flat : `${flat.slice(0, limit - 1)}…`
}

/** The first line of a body that says something, with markdown furniture removed. */
function firstLineOf(body: string): string {
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.replace(/^[#>\s*-]+/, '').trim()
    if (trimmed !== '') return trimmed
  }
  return ''
}

/** Strip the blank lines a closing fence leaves behind, and trailing whitespace. */
function cleanBody(raw: string): string {
  return raw.replace(/^(?:[ \t]*\r?\n)+/, '').trimEnd()
}

/**
 * Split a `SKILL.md` into name / description / body.
 *
 * Frontmatter is optional: a folder whose `SKILL.md` has no frontmatter `name` falls back to
 * the folder name (the caller supplies it), and a missing description is derived from the
 * document's first line so the run's hint still says something useful.
 */
export function parseSkillDocument(text: string): ParsedSkillDocument {
  const source = text.replace(/^\uFEFF/, '')
  const match = FRONTMATTER.exec(source)
  const fields = match ? parseFrontmatterFields(match[1]) : new Map<string, string>()
  const body = cleanBody(match ? source.slice(match[0].length) : source)
  const name = (fields.get('name') ?? '').trim()
  const described = (fields.get('description') ?? '').trim()
  return {
    ...(name === '' ? {} : { name }),
    description: oneLineDescription(described === '' ? firstLineOf(body) : described),
    body
  }
}

/**
 * True for a string that could be a skill NAME.
 *
 * This is not the containment guarantee — that is the registry looking a name up in what was
 * actually discovered, so no path is ever built from user input. It is the second guard, and
 * it keeps an obvious attempt (`../secrets`, `..\\secrets`, an absolute path, an empty name)
 * from ever matching a skill, even one whose folder happened to be named strangely.
 */
export function isSafeSkillName(name: string): boolean {
  const trimmed = name.trim()
  if (trimmed === '' || trimmed === '.' || trimmed === '..') return false
  if (trimmed.startsWith('.')) return false
  return !/[\\/\0]/.test(trimmed)
}

/** One directory's skills, in the order the filesystem listed them. */
async function discoverRoot(root: SkillRoot, reader: SkillFs): Promise<SkillSummary[]> {
  let entries: SkillDirEntry[]
  try {
    entries = await reader.list(root.dir)
  } catch {
    // An unreadable skills folder is "no skills", never a failed run.
    return []
  }

  const found: SkillSummary[] = []
  for (const entry of entries) {
    // Requirement, not an optimisation: a file is not a skill folder, and a hidden entry
    // (`.git`, `.DS_Store`) is not one either.
    if (!entry.directory || entry.name.startsWith('.')) continue
    const file = join(root.dir, entry.name, 'SKILL.md')
    let text: string | null
    try {
      text = await reader.read(file)
    } catch {
      text = null
    }
    if (text === null) continue
    const parsed = parseSkillDocument(text)
    const name = parsed.name ?? entry.name
    if (!isSafeSkillName(name)) continue
    found.push({ name, description: parsed.description, path: file, source: root.source })
  }
  return found
}

export interface LoadSkillsOptions {
  /**
   * Highest priority first. The agent service passes the project root before the user root, so
   * a project's own skill of a given name wins over the user's copy of it — a repository can
   * pin the procedure it needs, and the same name still resolves to exactly one skill.
   */
  roots: readonly SkillRoot[]
  /** Injected boundary; defaults to the real filesystem. */
  fs?: SkillFs
}

/**
 * The discovered skills, owned by one object.
 *
 * It owns the list the run is told about (names + descriptions) and answers "give me the body
 * of X", which is the only way a body reaches the model. Keeping both here is what makes the
 * exposure/invocation split a property of the code rather than a convention.
 */
export class SkillRegistry {
  private readonly ordered: readonly SkillSummary[]
  private readonly byName: ReadonlyMap<string, SkillSummary>

  constructor(skills: readonly SkillSummary[], private readonly fs: SkillFs) {
    const byName = new Map<string, SkillSummary>()
    for (const skill of skills) {
      // First writer wins: the caller's root order is the priority rule. Reaching this branch
      // twice for one name would be a bug in `loadSkills`, and keeping the first is still the
      // predictable answer.
      if (!byName.has(skill.name)) byName.set(skill.name, skill)
    }
    this.byName = byName
    this.ordered = [...byName.values()]
  }

  get size(): number {
    return this.ordered.length
  }

  list(): SkillSummary[] {
    return [...this.ordered]
  }

  names(): string[] {
    return this.ordered.map((skill) => skill.name)
  }

  has(name: string): boolean {
    return this.lookup(name) !== undefined
  }

  /**
   * The lines appended to a run's system hint. Deliberately names and descriptions only: the
   * bodies are what cost something, and the model can ask for exactly one when it needs it.
   */
  hint(): string | undefined {
    if (this.ordered.length === 0) return undefined
    const lines = this.ordered.map((skill) =>
      skill.description === '' ? `- ${skill.name}` : `- ${skill.name}: ${skill.description}`
    )
    return [
      `Skills available to this run (${this.ordered.length}). A skill is a procedure stored as ` +
        'data. When a task matches one, call "use_skill" with its exact name to load its ' +
        'instructions before acting — do not guess what it says.',
      ...lines
    ].join('\n')
  }

  /**
   * The body of a discovered skill, or `undefined` when the name is unknown.
   *
   * The path read here is the one discovery recorded; the argument is only ever compared
   * against names, so `../secrets` cannot turn into a path. A skill whose file disappeared
   * between discovery and invocation is also `undefined` — the caller tells those two cases
   * apart with `has()`.
   */
  async read(name: string): Promise<SkillDefinition | undefined> {
    const summary = this.lookup(name)
    if (summary === undefined) return undefined
    let text: string | null
    try {
      text = await this.fs.read(summary.path)
    } catch {
      text = null
    }
    if (text === null) return undefined
    return { ...summary, body: parseSkillDocument(text).body }
  }

  private lookup(name: string): SkillSummary | undefined {
    const wanted = name.trim()
    if (!isSafeSkillName(wanted)) return undefined
    return this.byName.get(wanted)
  }
}

/**
 * Scan every root and return the registry.
 *
 * Never throws for a missing or broken folder: "no skills installed" is a normal state, and a
 * skills directory must not be able to take a chat down.
 */
export async function loadSkills(options: LoadSkillsOptions): Promise<SkillRegistry> {
  const reader = options.fs ?? nodeSkillFs
  const found: SkillSummary[] = []
  const seen = new Set<string>()
  for (const root of options.roots) {
    for (const skill of await discoverRoot(root, reader)) {
      if (seen.has(skill.name)) continue
      seen.add(skill.name)
      found.push(skill)
    }
  }
  return new SkillRegistry(found, reader)
}
