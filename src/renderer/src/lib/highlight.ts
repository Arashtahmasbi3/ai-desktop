export type TokenType =
  | 'plain'
  | 'comment'
  | 'string'
  | 'number'
  | 'keyword'
  | 'tag'
  | 'attr'
  | 'punct'

export interface Token {
  type: TokenType
  text: string
}

const KEYWORDS: Record<string, string[]> = {
  js: 'const let var function return if else for while import from export default class extends new await async try catch finally throw typeof instanceof in of this super null undefined true false delete void yield static get set'.split(' '),
  py: 'def class return if elif else for while import from as pass raise try except finally with lambda yield async await None True False and or not in is global nonlocal self'.split(' '),
  go: 'func package import var const type struct interface return if else for range go defer chan map select switch case default break continue nil true false'.split(' '),
  rs: 'fn let mut const struct enum impl trait pub use mod return if else match for while loop in as where async await move dyn ref self Self true false'.split(' '),
  java: 'public private protected class interface extends implements new return if else for while try catch finally throw import package static final void int String boolean true false null'.split(' '),
  css: 'important media supports keyframes from to'.split(' ')
}

const COMMENT_PREFIX: Record<string, string> = {
  js: '//',
  ts: '//',
  py: '#',
  go: '//',
  rs: '//',
  java: '//',
  css: '/*',
  sh: '#',
  yml: '#',
  yaml: '#',
  sql: '--'
}

export function languageOf(path: string): string {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
  const map: Record<string, string> = {
    ts: 'js', tsx: 'js', js: 'js', jsx: 'js', mjs: 'js', cjs: 'js',
    py: 'py', go: 'go', rs: 'rs', java: 'java', css: 'css', scss: 'css',
    sh: 'sh', bash: 'sh', zsh: 'sh', yml: 'yml', yaml: 'yml', sql: 'sql',
    json: 'json', html: 'html', htm: 'html', md: 'md', xml: 'html', vue: 'html'
  }
  return map[ext] ?? 'plain'
}

function isWordChar(char: string): boolean {
  return /[A-Za-z0-9_$]/.test(char)
}

function readString(line: string, start: number): number {
  const quote = line[start]
  let i = start + 1
  while (i < line.length) {
    if (line[i] === '\\') i += 2
    else if (line[i] === quote) return i + 1
    else i++
  }
  return i
}

function readNumber(line: string, start: number): number {
  let i = start
  while (i < line.length && /[0-9a-fA-FxX._eE+-]/.test(line[i])) i++
  return i
}

function readWord(line: string, start: number): number {
  let i = start
  while (i < line.length && isWordChar(line[i])) i++
  return i
}

/** Tokenize a single line for syntax highlighting (no external deps). */
export function tokenize(line: string, language = 'plain'): Token[] {
  const tokens: Token[] = []
  const keywords = new Set(KEYWORDS[language] ?? [])
  const comment = COMMENT_PREFIX[language]
  let i = 0
  let plain = ''

  const flushPlain = (): void => {
    if (plain) {
      tokens.push({ type: 'plain', text: plain })
      plain = ''
    }
  }

  while (i < line.length) {
    const char = line[i]

    // Comments run to end of line.
    if (comment && line.startsWith(comment, i)) {
      flushPlain()
      tokens.push({ type: 'comment', text: line.slice(i) })
      return tokens
    }

    if (language === 'html' && line.startsWith('<!--', i)) {
      const end = line.indexOf('-->', i)
      flushPlain()
      const stop = end === -1 ? line.length : end + 3
      tokens.push({ type: 'comment', text: line.slice(i, stop) })
      i = stop
      continue
    }

    if (char === '"' || char === "'" || char === '`') {
      const end = readString(line, i)
      flushPlain()
      tokens.push({ type: 'string', text: line.slice(i, end) })
      i = end
      continue
    }

    if (/[0-9]/.test(char)) {
      const end = readNumber(line, i)
      flushPlain()
      tokens.push({ type: 'number', text: line.slice(i, end) })
      i = end
      continue
    }

    if (isWordChar(char)) {
      const end = readWord(line, i)
      const word = line.slice(i, end)
      flushPlain()
      if (keywords.has(word)) tokens.push({ type: 'keyword', text: word })
      else if (language === 'html' && line[i - 1] === '<') tokens.push({ type: 'tag', text: word })
      else tokens.push({ type: 'plain', text: word })
      i = end
      continue
    }

    flushPlain()
    tokens.push({ type: 'punct', text: char })
    i++
  }

  flushPlain()
  return tokens
}

export function tokenClassName(type: TokenType): string {
  switch (type) {
    case 'comment':
      return 'text-neutral-500 italic'
    case 'string':
      return 'text-emerald-400'
    case 'number':
      return 'text-amber-400'
    case 'keyword':
      return 'text-violet-400'
    case 'tag':
      return 'text-sky-400'
    case 'attr':
      return 'text-cyan-400'
    case 'punct':
      return 'text-neutral-400'
    default:
      return 'text-neutral-200'
  }
}
