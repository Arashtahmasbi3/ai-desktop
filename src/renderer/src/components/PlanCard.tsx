import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, ClipboardList, Pencil, Play, X } from 'lucide-react'
import { useStore } from '../store'
import type { PlanStep } from '@shared/plan'

/** The argument a user is most likely to tweak on a step, if any. */
function editableKey(step: PlanStep): string | null {
  for (const key of ['command', 'path', 'content']) {
    if (typeof step.arguments[key] === 'string') return key
  }
  return null
}

function warningKey(code: string): string {
  switch (code) {
    case 'too_long':
      return 'plan.warningTooLong'
    case 'loop':
      return 'plan.warningLoop'
    default:
      return 'plan.warningEmpty'
  }
}

/**
 * The Plan Mode approval card (v2.3.2, A.5). Shown before a mutating batch of
 * tool calls runs; the user can approve, edit step arguments, or cancel.
 */
export default function PlanCard(): JSX.Element | null {
  const { t } = useTranslation()
  const pending = useStore((state) => state.pendingPlan)
  const respondPlan = useStore((state) => state.respondPlan)
  const [editing, setEditing] = useState(false)
  const [drafts, setDrafts] = useState<PlanStep[]>([])

  const id = pending?.id
  useEffect(() => {
    if (pending) {
      setDrafts(pending.plan.steps)
      setEditing(false)
    }
    // Reset drafts whenever a new plan arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  if (!pending) return null

  const updateStep = (index: number, key: string, value: string): void => {
    setDrafts((current) =>
      current.map((step, i) =>
        i === index ? { ...step, arguments: { ...step.arguments, [key]: value } } : step
      )
    )
  }

  const approve = (): void => {
    if (editing) respondPlan({ type: 'modify', steps: drafts })
    else respondPlan({ type: 'approve' })
  }

  return (
    <div className="absolute inset-0 z-40 flex items-end justify-center bg-black/50 backdrop-blur-sm">
      <div className="mb-4 w-full max-w-2xl rounded-xl border border-border bg-bg-secondary shadow-2xl">
        <header className="flex items-center gap-2 border-b border-border px-4 py-3">
          <ClipboardList className="h-4 w-4 text-accent" />
          <h3 className="text-sm font-semibold text-neutral-100">{t('plan.title')}</h3>
          <span className="text-[11px] text-neutral-500">{t('plan.subtitle')}</span>
          <button
            type="button"
            onClick={() => respondPlan({ type: 'cancel' })}
            className="ml-auto rounded p-1 text-neutral-500 hover:bg-bg-tertiary hover:text-neutral-200"
            aria-label={t('plan.cancel')}
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="max-h-[45vh] overflow-y-auto px-4 py-3">
          {pending.warnings.length > 0 ? (
            <ul className="mb-3 space-y-1">
              {pending.warnings.map((warning) => (
                <li
                  key={warning.code}
                  className="flex items-center gap-1.5 text-[11px] text-amber-400"
                >
                  <AlertTriangle className="h-3.5 w-3.5" />
                  {t(warningKey(warning.code), { count: drafts.length })}
                </li>
              ))}
            </ul>
          ) : null}

          {editing ? (
            <p className="mb-2 text-[11px] text-neutral-500">{t('plan.editHint')}</p>
          ) : null}

          <ol className="space-y-2">
            {drafts.map((step, index) => {
              const key = editableKey(step)
              return (
                <li
                  key={step.id}
                  className="rounded-lg border border-border bg-bg-tertiary px-3 py-2"
                >
                  <div className="flex items-baseline gap-2">
                    <span className="text-xs font-semibold text-neutral-500">{index + 1}.</span>
                    <span className="text-xs text-neutral-200">{step.title}</span>
                    <code className="ml-auto rounded bg-black/30 px-1.5 py-0.5 font-mono text-[10px] text-accent">
                      {step.tool}
                    </code>
                  </div>
                  {editing && key ? (
                    <div className="mt-2">
                      <label className="mb-0.5 block text-[10px] text-neutral-500">
                        {t('plan.command')}
                      </label>
                      <textarea
                        dir="ltr"
                        value={String(step.arguments[key] ?? '')}
                        onChange={(event) => updateStep(index, key, event.target.value)}
                        rows={2}
                        className="w-full resize-y rounded border border-border bg-bg-secondary px-2 py-1 font-mono text-[11px] text-neutral-200 outline-none focus:border-accent"
                      />
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ol>
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
          <button
            type="button"
            onClick={() => respondPlan({ type: 'cancel' })}
            className="rounded-md px-3 py-1.5 text-xs text-neutral-400 hover:bg-bg-tertiary hover:text-neutral-200"
          >
            {t('plan.cancel')}
          </button>
          <button
            type="button"
            onClick={() => setEditing((value) => !value)}
            className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-neutral-300 hover:bg-bg-tertiary"
          >
            <Pencil className="h-3.5 w-3.5" />
            {t('plan.modify')}
          </button>
          <button
            type="button"
            onClick={approve}
            className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:brightness-110"
          >
            <Play className="h-3.5 w-3.5" />
            {editing ? t('plan.applyEdit') : t('plan.approve')}
          </button>
        </footer>
      </div>
    </div>
  )
}
