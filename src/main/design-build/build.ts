import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { validateDesign, type DesignBuildResult, type DesignProject } from '@shared/design'
import { renderPreviewHtml, renderSiteFiles } from './render'
import { zipStore } from './zip'

/**
 * Build a design into files (phase 3).
 *
 * The build is a pure function of the document plus two writes: a Vite project, a single-file preview and a zip. It
 * validates first and refuses — the same `validateDesign` the board's Save uses, so a page that cannot be reached
 * cannot become a site that is missing it.
 */
export interface BuildOptions {
  /** The design's own directory, e.g. `<appData>/designs/<id>`. */
  root: string
  now?: () => number
}

export type BuildResult = DesignBuildResult

export async function buildDesign(design: DesignProject, options: BuildOptions): Promise<BuildResult> {
  const validation = validateDesign(design)
  if (!validation.ok) throw new Error(validation.problems.join(' '))

  const siteDir = join(options.root, 'site')
  const files = renderSiteFiles(design)

  for (const [name, content] of Object.entries(files)) {
    const target = join(siteDir, name)
    await fs.mkdir(join(target, '..'), { recursive: true })
    await fs.writeFile(target, content, 'utf8')
  }

  const previewPath = join(options.root, 'preview.html')
  await fs.writeFile(previewPath, renderPreviewHtml(design), 'utf8')

  const zipPath = join(options.root, 'design-site.zip')
  await fs.writeFile(zipPath, zipStore(files))

  return { siteDir, previewPath, zipPath, files: Object.keys(files) }
}
