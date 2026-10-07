import type { ChatMessage } from '@shared/types'

/**
 * Heuristic text reduction for the *context sent to the model* (never for the
 * on-disk transcript). It operates on fenced code blocks: it strips comments and
 * blank lines, can elide very long blocks and drops duplicate blocks.
 *
 * The comment stripping is deliberately conservative — it only removes comments
 * that start a line, plus `//` trailing comments that are not part of a URL
 * (`http://…`). It is a token-saving pass, not a parser.
 */
export interface CompressOptions {
  /** Remove code comments. Default true. */
  stripComments?: boolean
  /** Remove blank lines inside code blocks. Default true. */
  stripBlankLines?: boolean
  /** Replace repeated code blocks with a placeholder. Default true. */
  dedupeCodeBlocks?: boolean
  /** Keep at most this many lines per code block (0 = unlimited). Default 0. */
  maxCodeBlockLines?: number
  /** Text used for an elided line range. */
  elisionMarker?: string
  /** Text used for a duplicate code block. */
  duplicateMarker?: string
}

const DEFAULTS: Required<
  Pick<CompressOptions, 'stripComments' | 'stripBlankLines' | 'dedupeCodeBlocks' | 'maxCodeBlockLines'>
> = {
  stripComments: true,
  stripBlankLines: true,
  dedupeCodeBlocks: true,
  maxCodeBlockLines: 0
}

const FENCE = /```([^\n`]*)\n([\s\S]*?)```/g

function stripLineComment(line: string): string {
  if (/^\s*(\/\/|#|--)\s?/.test(line)) return ''
  // Guarded inline `//`: the character before it must not be `:`, so URLs survive.
  return line.replace(/([^:])\/\/[^\n]*$/, '$1').replace(/\s+$/, '')
}

/** Compress the body of a single fenced code block. */
export function compressCodeBlock(code: string, options: CompressOptions = {}): string {
  const opts = { ...DEFAULTS, ...options }
  let lines = code.split('\n')

  if (opts.stripComments) {
    const withoutBlockComments = lines
      .join('\n')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/<!--[\s\S]*?-->/g, '')
    lines = withoutBlockComments.split('\n').map(stripLineComment)
  }
  if (opts.stripBlankLines) {
    lines = lines.filter((line) => line.trim() !== '')
  }
  if (opts.maxCodeBlockLines > 0 && lines.length > opts.maxCodeBlockLines) {
    const keep = opts.maxCodeBlockLines
    const head = Math.ceil(keep / 2)
    const tail = keep - head
    const elision = opts.elisionMarker ?? `... [${lines.length - keep} lines elided] ...`
    lines = [...lines.slice(0, head), elision, ...lines.slice(lines.length - tail)]
  }
  return `${lines.join('\n')}\n`
}

/** Compress every fenced code block in a text, deduplicating identical ones. */
export function compressText(text: string, options: CompressOptions = {}): string {
  const opts = { ...DEFAULTS, ...options }
  const seen = new Set<string>()

  const compressed = text.replace(FENCE, (_match, info: string, body: string) => {
    const code = compressCodeBlock(String(body), opts)
    const marker = opts.duplicateMarker ?? '[duplicate code block omitted]'
    if (opts.dedupeCodeBlocks) {
      const key = code.replace(/\s+/g, ' ').trim()
      if (key.length > 0) {
        if (seen.has(key)) return '```' + info + '\n' + marker + '\n```\n'
        seen.add(key)
      }
    }
    return '```' + info + '\n' + code + '```\n'
  })

  return compressed.replace(/\n{3,}/g, '\n\n')
}

/** Compress a single message, returning the original instance when unchanged. */
export function compressMessage(message: ChatMessage, options: CompressOptions = {}): ChatMessage {
  if (!message.content) return message
  const content = compressText(message.content, options)
  return content === message.content ? message : { ...message, content }
}

/** Compress a list of messages (immutably). */
export function compressMessages(
  messages: readonly ChatMessage[],
  options: CompressOptions = {}
): ChatMessage[] {
  return messages.map((message) => compressMessage(message, options))
}
