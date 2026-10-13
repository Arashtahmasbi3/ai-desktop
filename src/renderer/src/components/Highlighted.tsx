import { useMemo } from 'react'
import { tokenClassName, tokenize } from '../lib/highlight'

/** Render one source line with the lightweight tokenizer's colour classes. */
export default function HighlightedLine({
  text,
  language
}: {
  text: string
  language: string
}): JSX.Element {
  const tokens = useMemo(() => tokenize(text, language), [text, language])
  return (
    <>
      {tokens.map((token, index) => (
        // U-11: key by position *and* text, so an edited line cannot reuse the
        // previous token's DOM node (and stale styling).
        <span key={`${index}:${token.text}`} className={tokenClassName(token.type)}>
          {token.text}
        </span>
      ))}
    </>
  )
}
