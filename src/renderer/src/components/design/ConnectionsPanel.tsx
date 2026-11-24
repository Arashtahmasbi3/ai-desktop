import { useState } from 'react'
import {
  isSystemOnlyPage,
  reachablePages,
  type DesignEdge,
  type DesignProject,
  type EdgeTrigger
} from '@shared/design'
import i18n from '../../i18n'

/**
 * Connections (phase 2).
 *
 * A page nobody can reach is a page the user built and will never see, so this view is two things at once: the place
 * edges are created and removed, and the place that says, per page, whether a path to it exists. The check is the same
 * `reachablePages` the validator uses — one implementation, so the badge and the build cannot disagree.
 */
export default function ConnectionsPanel({
  design,
  onAdd,
  onRemove
}: {
  design: DesignProject
  onAdd: (from: string, to: string, trigger: EdgeTrigger) => void
  onRemove: (edgeId: string) => void
}): React.JSX.Element {
  const [from, setFrom] = useState(design.pages[0]?.id ?? '')
  const [to, setTo] = useState(design.pages[1]?.id ?? '')
  const [trigger, setTrigger] = useState<EdgeTrigger>('click')

  const reachable = reachablePages(design)
  const pageName = (id: string): string => design.pages.find((page) => page.id === id)?.name ?? id
  const canAdd = from !== '' && to !== '' && from !== to

  const triggerLabel = (value: EdgeTrigger): string =>
    value === 'submit'
      ? i18n.t('design.triggerSubmit')
      : value === 'redirect'
        ? i18n.t('design.triggerRedirect')
        : i18n.t('design.triggerClick')

  return (
    <div className="min-h-0 flex-1 overflow-auto p-4" data-testid="design-connections">
      <section className="mb-5 rounded border border-border p-3">
        <h3 className="mb-2 text-sm font-semibold text-fg-strong">{i18n.t('design.addEdge')}</h3>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-3xs text-fg-muted">
            {i18n.t('design.from')}
            <select
              value={from}
              onChange={(event) => setFrom(event.target.value)}
              className="rounded border border-border bg-bg-primary px-2 py-1 text-xs text-fg"
            >
              {design.pages.map((page) => (
                <option key={page.id} value={page.id}>
                  {page.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-3xs text-fg-muted">
            {i18n.t('design.to')}
            <select
              value={to}
              onChange={(event) => setTo(event.target.value)}
              className="rounded border border-border bg-bg-primary px-2 py-1 text-xs text-fg"
            >
              {design.pages.map((page) => (
                <option key={page.id} value={page.id}>
                  {page.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-3xs text-fg-muted">
            {i18n.t('design.trigger')}
            <select
              value={trigger}
              onChange={(event) => setTrigger(event.target.value as EdgeTrigger)}
              className="rounded border border-border bg-bg-primary px-2 py-1 text-xs text-fg"
            >
              <option value="click">{i18n.t('design.triggerClick')}</option>
              <option value="submit">{i18n.t('design.triggerSubmit')}</option>
              <option value="redirect">{i18n.t('design.triggerRedirect')}</option>
            </select>
          </label>
          <button
            type="button"
            disabled={!canAdd}
            onClick={() => onAdd(from, to, trigger)}
            data-testid="design-add-edge"
            className="rounded bg-accent-solid px-4 py-1.5 text-xs text-white disabled:opacity-40"
          >
            {i18n.t('design.add')}
          </button>
        </div>
      </section>

      <section className="mb-5">
        <h3 className="mb-2 text-sm font-semibold text-fg-strong">{i18n.t('design.pageStatus')}</h3>
        <ul className="flex flex-col gap-1" data-testid="design-reachability">
          {design.pages.map((page) => {
            const ok = page.id === 'home' || reachable.has(page.id) || isSystemOnlyPage(page)
            return (
              <li key={page.id} className="flex items-center justify-between rounded border border-border px-3 py-1.5">
                <span className="text-xs text-fg">{page.name}</span>
                <span className={`text-3xs ${ok ? 'text-success' : 'text-warning'}`}>
                  {ok ? i18n.t('design.reachable') : i18n.t('design.unreachable')}
                </span>
              </li>
            )
          })}
        </ul>
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-fg-strong">{i18n.t('design.connections')}</h3>
        {design.edges.length === 0 ? (
          <p className="text-xs text-fg-muted">{i18n.t('design.noEdges')}</p>
        ) : (
          <ul className="flex flex-col gap-1" data-testid="design-edges">
            {design.edges.map((edge: DesignEdge) => (
              <li
                key={edge.id}
                className="flex items-center justify-between rounded border border-border px-3 py-1.5"
              >
                <span className="text-xs text-fg">
                  {pageName(edge.from)} <span className="text-fg-muted">→</span> {pageName(edge.to)}
                  <span className="ms-2 text-3xs text-fg-muted">{triggerLabel(edge.trigger)}</span>
                </span>
                <button
                  type="button"
                  onClick={() => onRemove(edge.id)}
                  className="rounded border border-border px-2 py-0.5 text-3xs text-danger hover:bg-bg-tertiary"
                >
                  {i18n.t('design.deleteEdge')}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
