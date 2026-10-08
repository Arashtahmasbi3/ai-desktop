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
        <span key={index} className={tokenClassName(token.type)}>
          {token.text}
        </span>
      ))}
    </>
  )
}
