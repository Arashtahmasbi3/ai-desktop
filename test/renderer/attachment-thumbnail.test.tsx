// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import i18n from '../../src/renderer/src/i18n'
import AttachmentChip from '../../src/renderer/src/components/AttachmentChip'
import type { PendingAttachment } from '../../src/renderer/src/lib/context-gate'

/**
 * v3.0 — "no small review of images after uploading".
 *
 * Main already produced a small PNG data URL for every image attachment; the chip
 * simply never rendered it. These cases pin all three states the user can meet:
 * a thumbnail that must be shown, no thumbnail (a text file, or a release where
 * the thumbnailer was unavailable) which must look exactly like the old chip, and
 * the click that opens the full image in the shared modal primitive.
 */
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/wD/AL0AAAAASUVORK5CYII='

function attachment(overrides: Partial<PendingAttachment> = {}): PendingAttachment {
  return { id: 'att-1', name: 'shot.png', kind: 'image', bytes: 2048, ...overrides }
}

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

afterEach(cleanup)

describe('v3.0 — the attachment chip shows the preview main produced', () => {
  it('1. renders a 40×40 thumbnail for an image attachment that has one', () => {
    render(
      <AttachmentChip
        attachment={attachment({ thumbnail: PNG })}
        visionCapable
        onRemove={vi.fn()}
      />
    )

    const button = screen.getByTestId('attachment-thumb-shot.png')
    const img = button.querySelector('img')
    expect(img).toBeTruthy()
    expect(img!.getAttribute('src')).toBe(PNG)
    // The chip contract: rounded, cropped, and 40×40 (h-10 w-10).
    expect(img!.className).toContain('object-cover')
    expect(img!.className).toContain('rounded-clay-sm')
    expect(img!.className).toContain('h-10')
    expect(img!.className).toContain('w-10')
  })

  it('2. renders exactly the old chip when there is no thumbnail', () => {
    render(<AttachmentChip attachment={attachment()} visionCapable onRemove={vi.fn()} />)

    const chip = screen.getByTestId('attachment-chip-shot.png')
    expect(screen.queryByTestId('attachment-thumb-shot.png')).toBeNull()
    expect(chip.querySelector('img')).toBeNull()
    // The icon, the name and the size tooltip are still what they always were.
    expect(chip.querySelector('svg')).toBeTruthy()
    expect(chip.textContent).toContain('shot.png')
    expect(chip.getAttribute('title')).toBe('shot.png (2.0 KB)')
  })

  it('3. leaves a text attachment alone', () => {
    render(
      <AttachmentChip
        attachment={attachment({ name: 'notes.md', kind: 'text', bytes: 12 })}
        visionCapable
        onRemove={vi.fn()}
      />
    )

    expect(screen.queryByTestId('attachment-thumb-notes.md')).toBeNull()
    expect(document.querySelector('img')).toBeNull()
    expect(screen.getByTestId('attachment-chip-notes.md').textContent).toContain('notes.md')
  })

  it('4. clicking the thumbnail opens the full image in the shared modal', () => {
    render(
      <AttachmentChip
        attachment={attachment({ thumbnail: PNG })}
        visionCapable
        onRemove={vi.fn()}
      />
    )

    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByTestId('attachment-thumb-shot.png'))

    const dialog = screen.getByRole('dialog')
    expect(dialog.textContent).toContain('shot.png')
    const preview = within(dialog).getAllByRole('img')
    expect(preview).toHaveLength(1)
    expect(preview[0]!.getAttribute('src')).toBe(PNG)

    // The modal is dismissible with the shared close control, and the chip remains.
    fireEvent.click(within(dialog).getByLabelText(i18n.t('common.close')))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByTestId('attachment-chip-shot.png')).toBeTruthy()
  })

  it('5. keeps remove working next to the preview', () => {
    const onRemove = vi.fn()
    render(<AttachmentChip attachment={attachment({ thumbnail: PNG })} visionCapable onRemove={onRemove} />)

    fireEvent.click(screen.getByLabelText(i18n.t('common.remove')))
    expect(onRemove).toHaveBeenCalledTimes(1)
  })

  it('6. still warns when the model cannot see images', () => {
    render(<AttachmentChip attachment={attachment({ thumbnail: PNG })} visionCapable={false} onRemove={vi.fn()} />)

    const chip = screen.getByTestId('attachment-chip-shot.png')
    expect(chip.textContent).toContain(i18n.t('chat.attachNoVision'))
    expect(chip.className).toContain('border-warning/50')
    // The preview is still offered — the bytes arrived, the model simply cannot read them.
    expect(screen.getByTestId('attachment-thumb-shot.png')).toBeTruthy()
  })
})
