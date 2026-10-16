/**
 * What a run should produce, and the extra places it may read (v3.0).
 *
 * The composer's Sources/Outputs panel lets the user *declare* intent before a run
 * instead of hoping the model infers it: "produce a site", "write this file", "you
 * may also read this folder". Nothing here is an execution permission — the panel
 * only shapes the prompt, exactly like the attachment block `@shared/attachments`
 * adds. Authentication, path containment and the approval gate are untouched.
 *
 * Pure and dependency-free, so the renderer (panel + prompt) and a unit test share
 * the same wording.
 */

/** The three things the panel can declare as a run's product. */
export type RunOutputKind = 'file' | 'site' | 'folder'

/** Ordered for the picker; the first entry is the default. */
export const RUN_OUTPUT_KINDS: readonly RunOutputKind[] = ['file', 'site', 'folder'] as const

/** One declared output. */
export interface RunOutput {
  /** Stable client-side id, so the list can be keyed and removed. */
  id: string
  kind: RunOutputKind
  /** Optional target path or name, e.g. `reports/summary.md`. */
  target?: string
}

/**
 * A source that is not an attachment: a folder picked with the existing
 * `dialog:pickDirectory`. It travels into the prompt as text and nothing else —
 * the renderer never reads it.
 */
export interface RunSource {
  id: string
  kind: 'folder'
  value: string
}

const KIND_NOUN: Record<RunOutputKind, string> = {
  file: 'a file',
  site: 'a site',
  folder: 'a folder'
}

/** True for a kind the UI and the prompt builder both understand. */
export function isRunOutputKind(value: unknown): value is RunOutputKind {
  return value === 'file' || value === 'site' || value === 'folder'
}

/** One-line description of a declared output, e.g. "a file (target: `x.md`)". */
export function describeRunOutput(output: RunOutput): string {
  const noun = isRunOutputKind(output?.kind) ? KIND_NOUN[output.kind] : 'an output'
  const target = String(output?.target ?? '').trim()
  return target ? `${noun} (target: \`${target}\`)` : noun
}

/**
 * The paragraph appended to the task that tells the model what the user declared.
 *
 * Deliberately short and explicit ("This run should produce: …") rather than
 * clever: it is the same kind of hint `buildAttachmentBlock` gives for files, and
 * it returns `''` when the user declared nothing, so an ordinary send is
 * byte-for-byte what it was before this feature existed.
 */
export function buildRunIntentBlock(
  outputs: ReadonlyArray<RunOutput> | undefined,
  sources: ReadonlyArray<RunSource> | undefined
): string {
  const declared = (Array.isArray(outputs) ? outputs : []).filter(
    (output) => output && isRunOutputKind(output.kind)
  )
  const folders = (Array.isArray(sources) ? sources : [])
    .map((source) => String(source?.value ?? '').trim())
    .filter((value) => value !== '')

  const lines: string[] = []
  if (declared.length > 0) {
    lines.push(
      'This run should produce:',
      ...declared.map((output) => `- ${describeRunOutput(output)}`)
    )
  }
  if (folders.length > 0) {
    if (lines.length > 0) lines.push('')
    lines.push(
      'The user also marked these folders as sources this run may read:',
      ...folders.map((folder) => `- \`${folder}\``)
    )
  }
  return lines.join('\n')
}
