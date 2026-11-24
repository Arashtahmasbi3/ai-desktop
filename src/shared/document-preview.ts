/**
 * What the renderer may receive as a document preview (T10).
 *
 * Shared, because the parser lives in main and the component in the renderer, and the IPC boundary should have one shape
 * both sides agree on. `unsupported` carries the reason, so the panel can say why a file cannot be previewed instead of
 * showing an empty box.
 */
export type DocumentPreview =
  | { kind: 'docx'; text: string }
  | { kind: 'xlsx'; rows: string[][] }
  | { kind: 'csv'; rows: string[][] }
  | { kind: 'unsupported'; reason: string }

/** The extensions this preview owns. `null` means the ordinary text viewer handles the file. */
export function documentKind(path: string): 'docx' | 'xlsx' | 'csv' | null {
  const lower = path.toLowerCase()
  if (lower.endsWith('.docx')) return 'docx'
  if (lower.endsWith('.xlsx')) return 'xlsx'
  if (lower.endsWith('.csv') || lower.endsWith('.tsv')) return 'csv'
  return null
}
