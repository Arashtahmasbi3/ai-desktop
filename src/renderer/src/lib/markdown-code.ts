interface HastLike {
  tagName?: string
  properties?: { className?: unknown }
  children?: HastLike[]
  value?: string
}

/** Pull the raw text + language out of a fenced code block's hast node. */
export function readCode(node: unknown): { code: string; language: string } {
  const element = node as HastLike | undefined
  const codeEl = element?.children?.find((child) => child.tagName === 'code')
  const classes = Array.isArray(codeEl?.properties?.className)
    ? (codeEl?.properties?.className as string[])
    : []
  const language = classes.find((name) => name.startsWith('language-'))?.slice(9) ?? ''
  const code = (codeEl?.children ?? [])
    .map((child) => child.value ?? '')
    .join('')
    .replace(/\n$/, '')
  return { code, language }
}
