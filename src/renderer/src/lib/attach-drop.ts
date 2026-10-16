/**
 * Drop and paste attachment plumbing (v3.1).
 *
 * Found while closing the plan's item 4: the app had **no** paste/drag-drop attachment path, and
 * the only drop handler in the tree treated every dropped item as a **project** — dropping a
 * screenshot opened a project pointing at a file.
 *
 * The decision "does this payload carry files we can attach, or is it the user pasting text?" is the
 * part worth isolating: it is pure, it is what the tests can pin, and getting it wrong in either
 * direction is bad — attaching when the user meant to paste text breaks typing, and ignoring a real
 * file silently loses the user's action.
 *
 * A raw bitmap from a screenshot tool has **no file behind it**, so there is no path for main to
 * register. That case is reported rather than dropped on the floor; supporting it needs main to
 * accept renderer-provided bytes, which is a separate, security-relevant change.
 */

export type PasteIntent = 'attach' | 'image-unsupported' | 'text'

/** Minimal shapes, so the callers' DOM types do not leak into the logic. */
export interface FileLike {
  name?: string
}
export interface DataTransferItemLike {
  type?: string
}

/** The OS paths behind a payload, dropping the ones the OS gives us no path for. */
export function attachmentPaths(
  files: ArrayLike<FileLike> | null | undefined,
  pathForFile: (file: FileLike) => string
): string[] {
  if (!files) return []
  const out: string[] = []
  for (const file of Array.from(files)) {
    const path = pathForFile(file)
    if (typeof path === 'string' && path !== '') out.push(path)
  }
  return out
}

/** The same path must never be attached twice, however the user got it here. */
export function dedupePaths(paths: readonly string[]): string[] {
  return [...new Set(paths.filter((path) => typeof path === 'string' && path !== ''))]
}

/**
 * What a paste means.
 *
 * - `attach` — it carries one or more files with a path, so it is a file the user wants to send.
 * - `image-unsupported` — it carries image data with **no** file behind it (a screenshot tool's
 *   bitmap); we say so instead of losing the action.
 * - `text` — anything else, which must be left entirely alone so pasting text into the composer
 *   keeps working exactly as before.
 */
export function pasteIntent(input: {
  files: ArrayLike<FileLike> | null | undefined
  items: ArrayLike<DataTransferItemLike> | null | undefined
  pathForFile: (file: FileLike) => string
}): PasteIntent {
  if (attachmentPaths(input.files, input.pathForFile).length > 0) return 'attach'
  const items = input.items ? Array.from(input.items) : []
  if (items.some((item) => typeof item.type === 'string' && item.type.startsWith('image/'))) {
    return 'image-unsupported'
  }
  return 'text'
}
