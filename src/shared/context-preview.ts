/**
 * Privacy preview of the context an agent run will send to the model
 * (v2.3.2, B.4). Pure and dependency-free so both the renderer (Chat) and the
 * main process can build it from the same inputs.
 */

import { isSecretPath as isSecretPathImpl } from './secret-paths'

export interface ContextPreviewInput {
  provider?: string
  model: string
  systemPrompt?: string
  messages: Array<{ role: string; content: string }>
  /** Workspace-relative files offered as context. */
  files?: string[]
  /** Remote directories/paths included as context. */
  remotePaths?: string[]
}

export interface IncludedSection {
  key: 'system' | 'history' | 'files' | 'remote'
  label: string
  tokens: number
}

export interface ContextPreview {
  provider: string
  model: string
  /** Estimated total tokens that will be sent. */
  tokens: number
  included: IncludedSection[]
  /** Files withheld because they look like secrets. */
  blockedFiles: string[]
  /** Things that are never sent. */
  excluded: string[]
}

/** Categories that are always withheld, surfaced verbatim in the UI. */
export const EXCLUDED_ALWAYS = [
  '.env and other secret files',
  'Private keys and credentials',
  // v2.9.0: this used to read "Files outside the workspace", which is now false —
  // a file the user attaches is copied into the run workspace and read there, so
  // the dialog must not claim it is withheld. What is still true is that the agent
  // cannot browse the desktop on its own and only ever sees what was attached.
  'Anything on your desktop you did not attach (the agent cannot browse your computer)'
]


/**
 * True when a path looks like it holds secret material and must not be sent.
 *
 * v2.6.2: delegates to `@shared/secret-paths`, the canonical Secret Path Guard,
 * so the preview can never disagree with what the sandbox/remote tools block.
 */
export function isSecretPath(path: string): boolean {
  return isSecretPathImpl(path)
}

/** Rough token estimate: ~4 characters per token, rounded up. */
export function estimateTokens(text: string): number {
  return text ? Math.ceil(text.length / 4) : 0
}

/** Build the transparency preview for the next send. */
export function buildContextPreview(input: ContextPreviewInput): ContextPreview {
  const messages = input.messages ?? []
  const historyText = messages.map((message) => message.content ?? '').join('\n')
  const offeredFiles = input.files ?? []
  const blockedFiles = offeredFiles.filter(isSecretPath)
  const safeFiles = offeredFiles.filter((file) => !isSecretPath(file))
  const remotePaths = (input.remotePaths ?? []).filter((path) => !isSecretPath(path))

  const systemTokens = estimateTokens(input.systemPrompt ?? '')
  const historyTokens = estimateTokens(historyText)

  const included: IncludedSection[] = []
  if (systemTokens > 0) included.push({ key: 'system', label: 'System prompt', tokens: systemTokens })
  if (historyTokens > 0) included.push({ key: 'history', label: 'Chat history', tokens: historyTokens })
  if (safeFiles.length > 0) {
    included.push({
      key: 'files',
      label: `Files: ${safeFiles.join(', ')}`,
      tokens: estimateTokens(safeFiles.join('\n'))
    })
  }
  if (remotePaths.length > 0) {
    included.push({
      key: 'remote',
      label: `Remote context: ${remotePaths.join(', ')}`,
      tokens: estimateTokens(remotePaths.join('\n'))
    })
  }

  const tokens = included.reduce((sum, section) => sum + section.tokens, 0)

  return {
    provider: input.provider?.trim() || 'Unknown provider',
    model: input.model,
    tokens,
    included,
    blockedFiles,
    excluded: EXCLUDED_ALWAYS
  }
}

/** Plain-text rendering of the preview, used for copy and the expanded view. */
export function formatContextPreview(preview: ContextPreview): string {
  const lines = [
    'Context to be sent',
    `Provider: ${preview.provider}`,
    `Model: ${preview.model}`,
    `Tokens (estimated): ${preview.tokens.toLocaleString('en-US')}`,
    '',
    'Included:'
  ]
  for (const section of preview.included) {
    lines.push(` • ${section.label} (${section.tokens.toLocaleString('en-US')} tokens)`)
  }
  if (preview.blockedFiles.length > 0) {
    lines.push('', 'Withheld (looks like secrets):', ...preview.blockedFiles.map((f) => ` • ${f}`))
  }
  lines.push('', 'NOT included:', ...preview.excluded.map((item) => ` • ${item}`))
  return lines.join('\n')
}
