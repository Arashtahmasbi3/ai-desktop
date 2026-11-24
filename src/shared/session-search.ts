/**
 * A search hit in a past conversation (T12), and its one-line model-facing form.
 *
 * Shared because the scanner lives in main and the tool that reports it lives in core; the shape is the contract between
 * them, and neither layer should import the other to get it.
 */
export interface SessionHit {
  chatId: string
  title: string
  /** Message-level snippet around the match, for a preview. */
  snippet: string
  /** 1-based line of the matching message in the conversation; 0 for a title match. */
  messageIndex: number
  role: 'user' | 'assistant'
  at: number
  /** Title match ranks above a body match. */
  inTitle: boolean
}

export function formatSessionHits(hits: SessionHit[]): string {
  if (hits.length === 0) return 'موردی در گفت‌وگوهای قبلی پیدا نشد.'
  return hits
    .map(
      (hit) =>
        `${hit.inTitle ? 'عنوان' : hit.messageIndex === 0 ? 'گفت‌وگو' : `پیام ${hit.messageIndex}`} — «${hit.title}»\n  ${hit.snippet.replace(/\s+/g, ' ').trim()}`
    )
    .join('\n')
}
