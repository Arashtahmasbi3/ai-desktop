import { promises as fs } from 'node:fs'
import type { Dirent } from 'node:fs'
import { join, relative, sep } from 'node:path'
import type { CodeMatch } from '@shared/ui'

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'out',
  'build',
  'coverage',
  '.next',
  '.turbo',
  '.cache',
  'release'
])

const TEXT_EXTENSIONS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'json', 'md', 'mdx', 'css', 'scss', 'html',
  'py', 'rb', 'go', 'rs', 'java', 'kt', 'c', 'h', 'cpp', 'hpp', 'cs', 'php', 'swift',
  'sh', 'bash', 'zsh', 'ps1', 'yml', 'yaml', 'toml', 'ini', 'env', 'sql', 'txt', 'xml'
])

const MAX_FILE_BYTES = 512 * 1024
const MAX_RESULTS = 200
const MAX_FILES = 5_000

export interface SearchOptions {
  caseSensitive?: boolean
  limit?: number
}

/**
 * Literal, case-insensitive search across the project's text files. Skips
 * build/dependency directories and stops at a bounded number of files/results.
 */
export async function searchProject(
  root: string,
  query: string,
  options: SearchOptions = {}
): Promise<CodeMatch[]> {
  const needle = query.trim()
  if (!needle) return []
  const haystack = options.caseSensitive ? needle : needle.toLowerCase()
  const limit = options.limit ?? MAX_RESULTS
  const matches: CodeMatch[] = []
  let files = 0

  async function walk(dir: string): Promise<void> {
    if (matches.length >= limit || files >= MAX_FILES) return
    let entries: Dirent[]
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (matches.length >= limit || files >= MAX_FILES) return
      const absolute = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue
        await walk(absolute)
        continue
      }
      if (!entry.isFile()) continue
      const ext = entry.name.split('.').pop()?.toLowerCase() ?? ''
      if (!TEXT_EXTENSIONS.has(ext) && !entry.name.startsWith('.env')) continue
      files += 1
      await searchFile(absolute)
    }
  }

  async function searchFile(absolute: string): Promise<void> {
    let content: string
    try {
      const stats = await fs.stat(absolute)
      if (stats.size > MAX_FILE_BYTES) return
      content = await fs.readFile(absolute, 'utf8')
    } catch {
      return
    }
    if (content.includes('\u0000')) return
    const lines = content.split('\n')
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]
      const target = options.caseSensitive ? line : line.toLowerCase()
      if (!target.includes(haystack)) continue
      matches.push({
        path: relative(root, absolute).split(sep).join('/'),
        line: index + 1,
        text: line.length > 400 ? `${line.slice(0, 400)}…` : line
      })
      if (matches.length >= limit) return
    }
  }

  await walk(root)
  return matches
}
