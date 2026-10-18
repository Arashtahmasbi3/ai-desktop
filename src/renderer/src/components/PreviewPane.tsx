import ReactMarkdown from 'react-markdown'
import { useTranslation } from 'react-i18next'
import { FileQuestion } from 'lucide-react'

export type PreviewKind = 'markdown'

/** Which renderer (if any) can preview a path in-app. */
export function previewKind(path: string | null | undefined): PreviewKind | null {
  if (!path) return null
  const lower = path.toLowerCase()
  if (lower.endsWith('.md') || lower.endsWith('.markdown') || lower.endsWith('.mdx')) {
    return 'markdown'
  }
  return null
}

const MARKDOWN_COMPONENTS = {
  h1: (props: JSX.IntrinsicElements['h1']) => (
    <h1 className="mb-2 mt-4 text-lg font-semibold text-fg-strong" {...props} />
  ),
  h2: (props: JSX.IntrinsicElements['h2']) => (
    <h2 className="mb-2 mt-4 text-base font-semibold text-fg-strong" {...props} />
  ),
  h3: (props: JSX.IntrinsicElements['h3']) => (
    <h3 className="mb-1 mt-3 text-sm font-semibold text-fg-strong" {...props} />
  ),
  p: (props: JSX.IntrinsicElements['p']) => (
    <p className="my-2 leading-relaxed text-fg" {...props} />
  ),
  ul: (props: JSX.IntrinsicElements['ul']) => (
    <ul className="my-2 list-disc pl-5 text-fg" {...props} />
  ),
  ol: (props: JSX.IntrinsicElements['ol']) => (
    <ol className="my-2 list-decimal pl-5 text-fg" {...props} />
  ),
  a: (props: JSX.IntrinsicElements['a']) => (
    <a className="text-accent underline" {...props} />
  ),
  code: (props: JSX.IntrinsicElements['code']) => (
    <code className="rounded bg-bg-tertiary px-1 font-mono text-2xs text-fg" {...props} />
  ),
  pre: (props: JSX.IntrinsicElements['pre']) => (
    <pre className="my-2 overflow-auto rounded-lg bg-bg-tertiary p-3 font-mono text-2xs" {...props} />
  ),
  blockquote: (props: JSX.IntrinsicElements['blockquote']) => (
    <blockquote className="my-2 border-l-2 border-border pl-3 text-fg-muted" {...props} />
  )
}

/**
 * In-app preview for files the renderer can safely display. Markdown is
 * rendered; anything else asks the user to use the editor or the browser
 * (HTML is never executed in the privileged renderer).
 */
export default function PreviewPane({
  path,
  content
}: {
  path: string
  content: string
}): JSX.Element {
  const { t } = useTranslation()
  const kind = previewKind(path)

  if (kind !== 'markdown') {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 bg-bg-primary text-fg-subtle">
        <FileQuestion className="h-7 w-7" />
        <p className="max-w-xs text-center text-xs">{t('previewPane.noPreview')}</p>
      </div>
    )
  }

  return (
    <div
      className="min-h-0 flex-1 overflow-auto bg-bg-primary px-5 py-4 text-sm"
      dir="ltr"
    >
      <ReactMarkdown components={MARKDOWN_COMPONENTS}>{content}</ReactMarkdown>
    </div>
  )
}
