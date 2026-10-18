import type { ProviderEntry } from '@core/agent-orchestrator'
import { buildAttachmentBlock, planAttachmentPaths, type AttachmentRef } from '@shared/attachments'
import type { ContentPart } from '@shared/types'
import type { AttachmentService } from '../attachment-service'

/**
 * The attachments a run was given, resolved into what the model is told and shown (F0-4).
 *
 * Split out of `agent-service.ts` as a free function: it reads one injected service and
 * touches no other part of the run.
 */

export interface AttachmentContext {
  refs: AttachmentRef[]
  hint: string
  imageParts?: ContentPart[]
}

/**
 * v2.9.0: turn the attachment ids the composer sent into (a) the text block the model
 * is told about, (b) inline image parts when the selected model can actually see them.
 *
 * The order of `refs` is the registry order filtered by the requested ids, which is
 * exactly what `AttachmentService.stage` walks — so the workspace path the model is
 * told about is the path that gets written, including the `-2` suffix for a duplicate
 * file name. Vision is decided by the adapter's `getCapabilities`, the runtime
 * authority; the prompt says so plainly when the answer is no, so the model cannot
 * pretend to have looked at an image.
 */
export async function buildAttachmentContext(
  attachments: AttachmentService | undefined,
  ids: string[] | undefined,
  entry: ProviderEntry | undefined
): Promise<AttachmentContext> {
  if (!attachments || !Array.isArray(ids) || ids.length === 0) {
    return { refs: [], hint: '' }
  }
  const wanted = new Set(ids)
  const refs = attachments.refs().filter((ref) => wanted.has(ref.id))
  if (refs.length === 0) return { refs: [], hint: '' }

  const vision = entry ? entry.adapter.getCapabilities(entry.config.model).vision : false
  const planned = planAttachmentPaths(refs.map((ref) => ({ id: ref.id, name: ref.name })))
  const pathById = new Map(planned.map((item) => [item.id, item.workspacePath]))

  const imageParts: ContentPart[] = []
  if (vision) {
    for (const ref of refs) {
      if (ref.kind !== 'image' || ref.mediaType === undefined) continue
      try {
        const image = await attachments.readImage(ref.id)
        imageParts.push({ type: 'image', mediaType: image.mediaType, base64: image.base64 })
      } catch {
        // A file that vanished between registering and running must not fail the run:
        // the prompt still names it, so the model can report it honestly.
      }
    }
  }

  const hint = buildAttachmentBlock(
    refs.map((ref) => {
      const workspacePath = pathById.get(ref.id)
      return {
        name: ref.name,
        ...(workspacePath ? { workspacePath } : {}),
        kind: ref.kind,
        bytes: ref.bytes,
        vision
      }
    })
  )
  return { refs, hint, ...(imageParts.length > 0 ? { imageParts } : {}) }
}