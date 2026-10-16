import { describe, expect, it } from 'vitest'
import {
  attachmentPaths,
  dedupePaths,
  pasteIntent,
  type FileLike
} from '../../src/renderer/src/lib/attach-drop'

/**
 * Drop and paste plumbing (v3.1).
 *
 * The app had no paste/drag-drop attachment path, and the only drop handler in the tree added every
 * dropped item as a **project** — dropping a screenshot opened a project pointing at a file. These
 * cases pin the decision each direction of which is a real bug: attaching when the user meant to
 * paste text breaks typing, and silently ignoring a real file loses the user's action.
 */
const file = (name: string): FileLike => ({ name })

/** Stands in for Electron's `webUtils.getPathForFile`: real files have a path, bitmaps do not. */
const withPath = (target: FileLike): string => `C:\\Users\\me\\${target.name ?? 'file'}`
const withoutPath = (): string => ''

describe('attachmentPaths (v3.1)', () => {
  it('returns the OS paths, in the order the payload gave them', () => {
    expect(attachmentPaths([file('a.png'), file('b.txt')], withPath)).toEqual([
      'C:\\Users\\me\\a.png',
      'C:\\Users\\me\\b.txt'
    ])
  })

  it('drops the entries the OS gives no path for, rather than passing an empty string on', () => {
    // An empty path would reach main as a request to register nothing, or worse, something else.
    expect(attachmentPaths([file('a.png')], withoutPath)).toEqual([])
  })

  it('is empty — not a crash — for a missing payload', () => {
    expect(attachmentPaths(null, withPath)).toEqual([])
    expect(attachmentPaths(undefined, withPath)).toEqual([])
  })
})

describe('dedupePaths (v3.1)', () => {
  it('attaches the same file once, however the user got it here', () => {
    expect(dedupePaths(['C:\\a.png', 'C:\\a.png', 'C:\\b.png'])).toEqual(['C:\\a.png', 'C:\\b.png'])
  })

  it('filters blanks, which are a payload quirk rather than a file', () => {
    expect(dedupePaths(['', 'C:\\a.png'])).toEqual(['C:\\a.png'])
  })
})

describe('pasteIntent (v3.1)', () => {
  it('attaches when the clipboard carries a real file', () => {
    expect(
      pasteIntent({ files: [file('report.pdf')], items: [], pathForFile: withPath })
    ).toBe('attach')
  })

  it('reports an image with no file behind it instead of losing the paste', () => {
    // A screenshot tool's bitmap: image data, no path. Say so; do not drop it silently.
    expect(
      pasteIntent({
        files: [file('image.png')],
        items: [{ type: 'image/png' }],
        pathForFile: withoutPath
      })
    ).toBe('image-unsupported')
  })

  it('leaves an ordinary text paste completely alone', () => {
    // The critical case: pasting text into the composer must behave exactly as it did before.
    expect(
      pasteIntent({ files: [], items: [{ type: 'text/plain' }], pathForFile: withPath })
    ).toBe('text')
    expect(pasteIntent({ files: null, items: null, pathForFile: withPath })).toBe('text')
  })

  it('prefers attaching when there is both a file and image data', () => {
    // A copied file often arrives with a thumbnail item too; the file is what the user meant.
    expect(
      pasteIntent({
        files: [file('shot.png')],
        items: [{ type: 'image/png' }],
        pathForFile: withPath
      })
    ).toBe('attach')
  })
})
