import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, ClipboardList, Pencil, Play, X } from 'lucide-react'
import { useStore } from '../store'
import { toolLabel } from '../lib/tool-labels'
import type { PlanStep } from '@shared/plan'
import Modal from './ui/Modal'

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
  const [trust, setTrust] = useState(false)

  const id = pending?.id
  useEffect(() => {
    if (pending) {
      setDrafts(pending.plan.steps)
      setEditing(false)
      setTrust(false)
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
    if (editing) respondPlan({ type: 'modify', steps: drafts, trust })
    else respondPlan({ type: 'approve', trust })
  }

  return (
    <Modal
      open
      onClose={() => respondPlan({ type: 'cancel' })}
      maxWidth="42rem"
      ariaLabel={t('plan.title')}
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-3">
        <ClipboardList className="h-4 w-4 shrink-0 text-accent" />
        <h3 className="text-sm font-semibold text-fg-strong">{t('plan.title')}</h3>
        <span className="rounded bg-bg-tertiary px-1.5 py-0.5 text-3xs text-fg-muted">
          {t('plan.stepsCount', { count: drafts.length })}
        </span>
        <span className="hidden text-2xs text-fg-muted sm:inline">{t('plan.subtitle')}</span>
        <button
          type="button"
          onClick={() => respondPlan({ type: 'cancel' })}
          className="ml-auto shrink-0 rounded p-1 text-fg-muted hover:bg-bg-tertiary hover:text-fg"
          aria-label={t('plan.cancel')}
        >
          <X className="h-4 w-4" />
        </button>
      </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {pending.warnings.length > 0 ? (
            <ul className="mb-3 space-y-1">
              {pending.warnings.map((warning) => (
                <li
                  key={warning.code}
                  className="flex items-center gap-1.5 text-2xs text-warning"
                >
                  <AlertTriangle className="h-3.5 w-3.5" />
                  {t(warningKey(warning.code), { count: drafts.length })}
                </li>
              ))}
            </ul>
          ) : null}

          {editing ? (
            <p className="mb-2 text-2xs text-fg-muted">{t('plan.editHint')}</p>
          ) : null}

          <ol className="space-y-2">
            {drafts.map((step, index) => {
              const key = editableKey(step)
              return (
                <li
                  key={step.id}
                  data-testid="plan-step"
                  className="rounded-lg border border-border bg-bg-tertiary px-3 py-2"
                >
                  <div className="flex items-baseline gap-2">
                    <span className="text-xs font-semibold text-fg-muted">{index + 1}.</span>
                    {/*
                      The step title is the model's prose, so it picks its own direction — Persian
                      reads right-to-left here while the command below stays LTR.
                    */}
                    <span data-testid="plan-step-title" dir="auto" className="text-xs text-fg">
                      {step.title}
                    </span>
                    <code
                      className="ml-auto rounded bg-black/30 px-1.5 py-0.5 font-mono text-3xs text-accent"
                      title={step.tool}
                    >
                      {toolLabel(step.tool, t)}
                    </code>
                  </div>
                  {editing && key ? (
                    <div className="mt-2">
                      <label className="mb-0.5 block text-3xs text-fg-muted">
                        {t('plan.command')}
                      </label>
                      <textarea
                        dir="ltr"
                        value={String(step.arguments[key] ?? '')}
                        onChange={(event) => updateStep(index, key, event.target.value)}
                        rows={2}
                        className="w-full resize-y rounded border border-border bg-bg-secondary px-2 py-1 font-mono text-2xs text-fg outline-none focus:border-accent"
                      />
                    </div>
                  ) : key ? (
                    <pre
                      dir="ltr"
                      data-testid="plan-step-command"
                      className="mt-2 overflow-x-auto break-all rounded bg-bg-secondary/70 px-2 py-1 font-mono text-2xs whitespace-pre-wrap text-fg"
                    >
                      {String(step.arguments[key] ?? '')}
                    </pre>
                  ) : null}
                </li>
              )
            })}
          </ol>
        </div>

        <footer
          data-testid="plan-footer"
          className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3"
        >
          <label className="flex cursor-pointer items-center gap-2 text-2xs text-fg-muted">
            <input
              type="checkbox"
              checked={trust}
              onChange={(event) => setTrust(event.target.checked)}
              className="accent-accent"
            />
            {t('plan.trust')}
          </label>
          <div
            data-testid="plan-actions"
            className="flex flex-wrap items-center justify-end gap-2"
          >
            <button
              type="button"
              onClick={() => respondPlan({ type: 'cancel' })}
              className="whitespace-nowrap rounded-md px-3 py-1.5 text-xs text-fg-muted hover:bg-bg-tertiary hover:text-fg"
            >
              {t('plan.cancel')}
            </button>
            <button
              type="button"
              onClick={() => setEditing((value) => !value)}
              className="flex items-center gap-1.5 whitespace-nowrap rounded-md border border-border px-3 py-1.5 text-xs text-fg hover:bg-bg-tertiary"
            >
              <Pencil className="h-3.5 w-3.5" />
              {t('plan.modify')}
            </button>
            <button
              type="button"
              onClick={approve}
              className="flex items-center gap-1.5 whitespace-nowrap rounded-md bg-accent-solid px-3 py-1.5 text-xs font-medium text-white hover:brightness-110"
            >
              <Play className="h-3.5 w-3.5" />
              {editing ? t('plan.applyEdit') : t('plan.approve')}
            </button>
          </div>
        </footer>
    </Modal>
  )
}
