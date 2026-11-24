import { MODULE_TYPES, type DesignModule } from '@shared/design'
import { useStore } from '../../store'
import i18n from '../../i18n'

/**
 * The inspector (phase 1).
 *
 * Only what a non-technical user understands: a title, a line of text, a button label, and a free note for the AI. No
 * class names, no spacing controls, no colour pickers per module — the theme owns those. The note is the important
 * field: it is where the user's own idea survives until the chat reads it.
 */
export default function ModuleInspector({
  pageId,
  module
}: {
  pageId: string
  module: DesignModule | null
}): React.JSX.Element {
  const update = useStore((state) => state.updateDesignModule)
  const remove = useStore((state) => state.removeDesignModule)
  const vary = useStore((state) => state.varyDesignModule)
  const isCustom = module?.type === 'custom_section'

  if (!module) {
    return (
      <aside className="w-72 shrink-0 border-s border-border p-3" data-testid="module-inspector">
        <p className="text-xs text-fg-muted">{i18n.t('design.selectModule')}</p>
      </aside>
    )
  }

  const definition = MODULE_TYPES[module.type]
  const title = typeof module.props.title === 'string' ? module.props.title : ''
  const text = typeof module.props.text === 'string' ? module.props.text : ''
  const cta = typeof module.props.cta === 'string' ? module.props.cta : ''

  return (
    <aside className="flex w-72 shrink-0 flex-col gap-3 border-s border-border p-3" data-testid="module-inspector">
      <header>
        <p className="text-3xs text-fg-muted" dir="ltr">
          {module.type}
        </p>
        <h3 className="text-sm font-semibold text-fg-strong">{definition?.label ?? module.type}</h3>
      </header>

      <label className="flex flex-col gap-1 text-3xs text-fg-muted">
        {i18n.t('design.fieldTitle')}
        <input
          value={title}
          onChange={(event) => update(pageId, module.id, { title: event.target.value })}
          className="rounded border border-border bg-bg-primary px-2 py-1 text-xs text-fg"
        />
      </label>

      <label className="flex flex-col gap-1 text-3xs text-fg-muted">
        {i18n.t('design.fieldText')}
        <textarea
          value={text}
          rows={3}
          onChange={(event) => update(pageId, module.id, { text: event.target.value })}
          className="rounded border border-border bg-bg-primary px-2 py-1 text-xs text-fg"
        />
      </label>

      <label className="flex flex-col gap-1 text-3xs text-fg-muted">
        {i18n.t('design.fieldCta')}
        <input
          value={cta}
          onChange={(event) => update(pageId, module.id, { cta: event.target.value })}
          className="rounded border border-border bg-bg-primary px-2 py-1 text-xs text-fg"
        />
      </label>

      <label className="flex flex-col gap-1 text-3xs text-fg-muted">
        {i18n.t('design.fieldNotes')}
        <textarea
          value={module.notes ?? ''}
          rows={4}
          placeholder={i18n.t('design.notesPlaceholder')}
          onChange={(event) => update(pageId, module.id, { notes: event.target.value })}
          className="rounded border border-border bg-bg-primary px-2 py-1 text-xs text-fg"
        />
      </label>

      <button
        type="button"
        onClick={() => remove(pageId, module.id)}
        className="mt-auto rounded border border-border px-3 py-1.5 text-xs text-danger hover:bg-bg-tertiary"
      >
        {i18n.t('design.removeModule')}
      </button>
      {isCustom ? (
        <button
          type="button"
          onClick={() => vary(pageId, module.id)}
          data-testid="design-vary"
          className="rounded border border-border px-3 py-1.5 text-xs text-fg hover:bg-bg-tertiary"
        >
          {i18n.t('design.creativeVary')}
        </button>
      ) : null}
    </aside>
  )
}
