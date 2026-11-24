import { useEffect } from 'react'
import type { MemoryRecord } from '@shared/design-memory'
import { useStore } from '../../store'
import i18n from '../../i18n'

/**
 * The memory panel (phase 5).
 *
 * The user sees what the assistant remembers, why it remembers it (their own sentence), and can make it forget — without
 * ever editing JSON. Superseded records stay counted, not shown: history is kept, but the list is what is true now.
 */
export default function MemoryPanel({ designId }: { designId: string }): React.JSX.Element {
  const memory = useStore((state) => state.designMemory)
  const load = useStore((state) => state.loadDesignMemory)
  const forget = useStore((state) => state.forgetDesignMemory)

  useEffect(() => {
    void load(designId)
  }, [designId, load])

  const active = memory.records.filter((record) => record.status === 'active')
  const superseded = memory.records.filter((record) => record.status === 'superseded').length

  const scopeLabel = (record: MemoryRecord): string =>
    record.scope === 'global' ? i18n.t('design.memoryScopeGlobal') : record.scope

  return (
    <div className="min-h-0 flex-1 overflow-auto p-4" data-testid="design-memory">
      <h3 className="mb-1 text-sm font-semibold text-fg-strong">{i18n.t('design.memory')}</h3>
      <p className="mb-3 text-3xs text-fg-muted">{i18n.t('design.memoryHint')}</p>

      {active.length === 0 ? (
        <p className="rounded border border-dashed border-border px-4 py-8 text-center text-xs text-fg-muted">
          {i18n.t('design.memoryEmpty')}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {active.map((record) => (
            <li
              key={record.id}
              className="rounded border border-border px-3 py-2"
              data-testid={`design-memory-${record.id}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs text-fg-strong">{record.statement}</p>
                  <p className="text-3xs text-fg-muted">
                    {record.layer === 'decision'
                      ? i18n.t('design.memoryDecision')
                      : i18n.t('design.memoryPreference')}
                    {' · '}
                    {scopeLabel(record)}
                  </p>
                  <p className="mt-1 text-3xs text-fg-muted" dir="auto">
                    «{record.source.text}»
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void forget(designId, record.id)}
                  className="rounded border border-border px-2 py-0.5 text-3xs text-danger hover:bg-bg-tertiary"
                >
                  {i18n.t('design.memoryForget')}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {superseded > 0 ? (
        <p className="mt-3 text-3xs text-fg-muted">{i18n.t('design.memorySuperseded', { count: superseded })}</p>
      ) : null}
    </div>
  )
}
