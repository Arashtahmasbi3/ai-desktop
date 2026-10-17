import ReactMarkdown, { type Components } from 'react-markdown'
import CodeBlock from './CodeBlock'
import { readCode } from '../lib/markdown-code'

/**
 * The app's one markdown pipeline (v4.0.2).
 *
 * `MessageBubble` owned this map privately, so every other surface that shows the model's own
 * words printed the source instead of the prose: a real run's trace showed a row reading
 * `## وضعیت در Settings | … = **متوقف شد**` — literal hashes, asterisks and pipes. The map lives
 * here now and every prose surface renders through it, so there is one place to change what
 * "markdown looks like in this app" and no second, subtly different copy of it.
 *
 * Scope is deliberately narrow: **prose only**. Labels, tool ids, counts, exit codes and paths are
 * data and stay plain (monospace where the design language says so) — running a path through a
 * markdown parser is how `read_file` silently becomes *readfile*.
 */
export const MARKDOWN_COMPONENTS: Components = {
  pre: ({ node }) => {
    const { code, language } = readCode(node)
    if (!code) return null
    return <CodeBlock code={code} language={language} />
  },
  code: ({ children }) => (
    <code className="rounded-shape-sm border border-border bg-bg-primary px-1 py-0.5 font-mono text-[0.85em] text-accent">
      {children}
    </code>
  )
}

/**
 * A prose block outside the chat bubble: the same pipeline at the scale of the row it sits in.
 *
 * `chat-markdown` supplies the app's shared markdown spacing and bidi isolation; the
 * `compact-markdown` class (main.css) tightens it, because a trace step is a line in a log, not a
 * document — without it, one heading would push a whole card down with document margins.
 */
export interface MarkdownProseProps {
  /** The model's prose. Never a label, a count or a path. */
  text: string
  className?: string
  /** `auto` for model prose: it resolves its own direction from its first strong character. */
  dir?: 'auto' | 'ltr' | 'rtl'
  testId?: string
}

export function MarkdownProse({
  text,
  className = '',
  dir,
  testId
}: MarkdownProseProps): JSX.Element {
  return (
    <div dir={dir} data-testid={testId} className={`chat-markdown compact-markdown ${className}`.trim()}>
      <ReactMarkdown components={MARKDOWN_COMPONENTS}>{text}</ReactMarkdown>
    </div>
  )
}

/**
 * The one-line preview variant, for the trace's collapsed rows.
 *
 * A row stays a row: block elements are flattened to inline ones so `truncate` still clips to a
 * single line, while the elements themselves stay semantic (`<h2>`, `<strong>`, `<code>`) and no
 * marker is ever printed literally. The full block rendering is what the expanded body and the
 * reasoning block use — a reader who wants the document expands it.
 */
export const INLINE_MARKDOWN_COMPONENTS: Components = {
  ...MARKDOWN_COMPONENTS,
  p: ({ children }) => <span>{children} </span>,
  h1: ({ children }) => <h1 className="inline font-semibold text-fg-strong">{children}</h1>,
  h2: ({ children }) => <h2 className="inline font-semibold text-fg-strong">{children}</h2>,
  h3: ({ children }) => <h3 className="inline font-semibold text-fg-strong">{children}</h3>,
  h4: ({ children }) => <h4 className="inline font-semibold text-fg-strong">{children}</h4>,
  h5: ({ children }) => <h5 className="inline font-semibold text-fg-strong">{children}</h5>,
  h6: ({ children }) => <h6 className="inline font-semibold text-fg-strong">{children}</h6>,
  ul: ({ children }) => <span>{children}</span>,
  ol: ({ children }) => <span>{children}</span>,
  li: ({ children }) => <span className="me-1">{children}</span>,
  blockquote: ({ children }) => <span className="italic">{children}</span>,
  // A fenced block inside a one-line preview becomes an inline mono run, not a code panel.
  pre: ({ children }) => <span className="font-mono text-accent">{children}</span>
}

export function InlineMarkdown({ text }: { text: string }): JSX.Element {
  return <ReactMarkdown components={INLINE_MARKDOWN_COMPONENTS}>{text}</ReactMarkdown>
}
