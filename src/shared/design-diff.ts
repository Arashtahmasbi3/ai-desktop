import type { DesignProject } from './design'

/**
 * Structural diff between two design documents (phase 4).
 *
 * A text diff of two JSON files tells a user nothing; "two sections were added, one connection was removed" is the
 * sentence they can check against what they remember doing. So the diff is computed over the document's own structure
 * and is also what the history line stores, which keeps the version panel and the log from disagreeing.
 */
export interface DesignDiff {
  pagesAdded: string[]
  pagesRemoved: string[]
  modulesAdded: string[]
  modulesRemoved: string[]
  modulesChanged: string[]
  edgesAdded: number
  edgesRemoved: number
}

export function emptyDiff(): DesignDiff {
  return {
    pagesAdded: [],
    pagesRemoved: [],
    modulesAdded: [],
    modulesRemoved: [],
    modulesChanged: [],
    edgesAdded: 0,
    edgesRemoved: 0
  }
}

export function designDiff(before: DesignProject, after: DesignProject): DesignDiff {
  const diff = emptyDiff()
  const beforePages = new Map(before.pages.map((page) => [page.id, page]))
  const afterPages = new Map(after.pages.map((page) => [page.id, page]))

  for (const id of afterPages.keys()) if (!beforePages.has(id)) diff.pagesAdded.push(id)
  for (const id of beforePages.keys()) if (!afterPages.has(id)) diff.pagesRemoved.push(id)

  for (const [id, afterPage] of afterPages) {
    const beforePage = beforePages.get(id)
    if (!beforePage) {
      // A new page arrives with its modules: count them as additions, not as a page-level change.
      for (const module of afterPage.modules) diff.modulesAdded.push(module.id)
      continue
    }
    const beforeModules = new Map(beforePage.modules.map((module) => [module.id, module]))
    const afterModules = new Map(afterPage.modules.map((module) => [module.id, module]))
    for (const moduleId of afterModules.keys()) if (!beforeModules.has(moduleId)) diff.modulesAdded.push(moduleId)
    for (const moduleId of beforeModules.keys()) if (!afterModules.has(moduleId)) diff.modulesRemoved.push(moduleId)
    for (const [moduleId, afterModule] of afterModules) {
      const beforeModule = beforeModules.get(moduleId)
      if (!beforeModule) continue
      const sameProps = JSON.stringify(beforeModule.props) === JSON.stringify(afterModule.props)
      if (!sameProps || beforeModule.notes !== afterModule.notes) diff.modulesChanged.push(moduleId)
    }
  }

  const beforeEdges = new Set(before.edges.map((edge) => edge.id))
  const afterEdges = new Set(after.edges.map((edge) => edge.id))
  for (const id of afterEdges) if (!beforeEdges.has(id)) diff.edgesAdded += 1
  for (const id of beforeEdges) if (!afterEdges.has(id)) diff.edgesRemoved += 1

  return diff
}

/** The same diff as one short sentence, which is what the history line and the panel show. */
export function summarizeDiff(diff: DesignDiff): string {
  const parts: string[] = []
  const add = (count: number, one: string, many: string): void => {
    if (count === 0) return
    parts.push(count === 1 ? one : `${count} ${many}`)
  }
  add(diff.pagesAdded.length, 'یک صفحه اضافه شد', 'صفحه اضافه شد')
  add(diff.pagesRemoved.length, 'یک صفحه حذف شد', 'صفحه حذف شد')
  add(diff.modulesAdded.length, 'یک بخش اضافه شد', 'بخش اضافه شد')
  add(diff.modulesRemoved.length, 'یک بخش حذف شد', 'بخش حذف شد')
  add(diff.modulesChanged.length, 'یک بخش ویرایش شد', 'بخش ویرایش شد')
  add(diff.edgesAdded, 'یک اتصال اضافه شد', 'اتصال اضافه شد')
  add(diff.edgesRemoved, 'یک اتصال حذف شد', 'اتصال حذف شد')
  return parts.length === 0 ? 'بدون تغییر' : parts.join('، ')
}
